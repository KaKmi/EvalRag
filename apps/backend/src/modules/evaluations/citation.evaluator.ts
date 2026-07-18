import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ModelsService } from "../models/models.service";
import type { EvaluationInput, MetricResult } from "./evaluation.types";
import {
  callJudgeProvider,
  invalidJudgeOutput,
  limitedEvidence,
  parseJudgeOutput,
  repairInstruction,
  structuredOutput,
  withJudgeRetry,
  type PriorJudgeFailure,
} from "./evaluation-judge.utils";

/**
 * E-W2b F4：Citation Correctness（原型 §3.5）——每处引用 `[n]` 是否真支持它标注的那句结论
 * （逐引用 LLM 判定，reference-free）。score = supported 数 / 引用总数 × 100。
 *
 * **仅进记分卡 + evidence + 屏4 指标行，不进 verdict/minMetric/综合分**（diff D1）。
 * 无角标 / 全部越界 → 返回 null（未评：「无引用」），不调模型。
 *
 * schema 用**宽松 object + 归一化**（020 教训：勿 strictObject / 勿 strict:true）——DeepSeek 等
 * provider 会吐裸数组、字段同义词，归一化后再校验，比严格 schema 少大量假 NULL。
 */
const JudgmentSchema = z.object({
  n: z.number().int(),
  supported: z.boolean(),
  reason: z.string().min(1).max(500),
});
const InnerSchema = z.object({ judgments: z.array(JudgmentSchema) });

/** 归一化裁判漂移：裸数组包装为 {judgments}、字段同义词（support/supporting → supported）收敛。 */
function normalizeCitationOutput(raw: unknown): unknown {
  const obj = Array.isArray(raw) ? { judgments: raw } : raw;
  if (typeof obj !== "object" || obj === null) return obj;
  const judgments = (obj as { judgments?: unknown }).judgments;
  if (!Array.isArray(judgments)) return obj;
  return {
    judgments: judgments.map((item) => {
      if (typeof item !== "object" || item === null) return item;
      const it = item as Record<string, unknown>;
      const rawSupported = it.supported ?? it.support ?? it.supporting ?? it.isSupported;
      const supported =
        typeof rawSupported === "string"
          ? ["true", "supported", "support", "supporting", "yes"].includes(
              rawSupported.toLowerCase(),
            )
          : rawSupported;
      return {
        n: it.n ?? it.index ?? it.citation,
        supported,
        reason: it.reason ?? it.explanation ?? it.rationale ?? "",
      };
    }),
  };
}

const OutputSchema = z.preprocess(normalizeCitationOutput, InnerSchema);

/** 提取含 `[n]` 角标的句子（找不到取全文前 300 字）。 */
function sentenceForMark(answer: string, n: number): string {
  const sentences = answer.split(/(?<=[。！？.!?\n])/);
  const found = sentences.find((s) => new RegExp(`\\[${n}\\]`).test(s));
  return (found ?? answer.slice(0, 300)).trim();
}

@Injectable()
export class CitationEvaluator {
  constructor(private readonly models: ModelsService) {}

  /** @returns null = 未评（无 `[n]` 角标或全部越界）——不调模型。 */
  async score(input: EvaluationInput, judgeModelId: string): Promise<MetricResult | null> {
    const marks = [...new Set([...input.answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
      .filter((n) => n >= 1 && n <= input.contexts.length)
      .sort((a, b) => a - b);
    if (marks.length === 0) return null;

    const citations = marks.map((n) => ({
      n,
      sentence: sentenceForMark(input.answer, n),
      context: input.contexts[n - 1].text,
    }));

    const outputSpec = structuredOutput("evaluation_citation_v1", InnerSchema);
    const { output, usage } = await withJudgeRetry(
      "citation",
      async (priorFailure?: PriorJudgeFailure) => {
        const response = await callJudgeProvider(() =>
          this.models.chat(
            judgeModelId,
            [
              {
                role: "system",
                content:
                  "For each citation, decide whether the cited context actually supports the claim in the " +
                  'sentence that carries the citation marker. Return exactly one judgment per citation, each ' +
                  'with the citation number "n", a boolean "supported", and a short "reason". ' +
                  "Return JSON only, no markdown code fences.",
              },
              { role: "user", content: JSON.stringify({ citations }) },
              ...(priorFailure
                ? [{ role: "user" as const, content: repairInstruction(priorFailure) }]
                : []),
            ],
            { temperature: 0, structuredOutput: outputSpec },
          ),
        );
        const parsed = parseJudgeOutput(response.content, OutputSchema);
        // 判定必须恰好覆盖输入的引用集合（防模型回无关 n / 漏判）。
        const judgedNs = new Set(parsed.judgments.map((j) => j.n));
        const markSet = new Set(marks);
        if (
          judgedNs.size !== markSet.size ||
          [...judgedNs].some((n) => !markSet.has(n))
        ) {
          invalidJudgeOutput("citation judgments must cover each cited marker exactly once");
        }
        return { output: parsed, usage: response.usage };
      },
    );

    const supported = output.judgments.filter((j) => j.supported).length;
    const byN = new Map(citations.map((c) => [c.n, c.sentence]));
    const ordered = [...output.judgments].sort((a, b) => a.n - b.n);
    return {
      score: Math.round((supported / marks.length) * 100),
      evidence: limitedEvidence(
        ordered.map(
          (j) =>
            `[${j.supported ? "supported" : "unsupported"}] ${(byN.get(j.n) ?? "").slice(0, 80)} —— ${j.reason}`,
        ),
        "No citation evidence was returned.",
      ),
      usage,
    };
  }
}
