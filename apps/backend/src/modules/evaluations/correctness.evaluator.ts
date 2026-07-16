import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ModelsService } from "../models/models.service";
import type { CorrectnessInput, MetricResult } from "./evaluation.types";
import {
  callJudgeProvider,
  limitedEvidence,
  parseJudgeOutput,
  structuredOutput,
  withJudgeRetry,
} from "./evaluation-judge.utils";

/**
 * 018 决策 D：gold 对照指标（离线专用，在线三指标不含它）。
 * 原型 §7：「正确率显示 gold 要点比对(一致/缺失/矛盾)」——逐要点判定，score = 一致数/要点数。
 * 结构与 faithfulness.evaluator.ts 同款：structuredOutput + Zod strict + withJudgeRetry + limitedEvidence。
 */

const CorrectnessOutputSchema = z.strictObject({
  points: z
    .array(
      z.strictObject({
        point: z.string().min(1).max(200),
        status: z.enum(["hit", "missing", "contradicted"]),
        reason: z.string().min(1).max(300),
      }),
    )
    .max(20),
});

const CORRECTNESS_OUTPUT = structuredOutput("evaluation_correctness_v1", CorrectnessOutputSchema);

@Injectable()
export class CorrectnessEvaluator {
  constructor(private readonly models: ModelsService) {}

  async score(input: CorrectnessInput, judgeModelId: string): Promise<MetricResult> {
    // 调用方（scoreOffline）保证 goldPoints 非空；防御性兜底：无 gold 无从比对，不调模型。
    if (input.goldPoints.length === 0) {
      return { score: 0, evidence: ["No gold points supplied."] };
    }

    const { output, usage } = await withJudgeRetry("correctness", async () => {
      const response = await callJudgeProvider(() =>
        this.models.chat(
          judgeModelId,
          [
            {
              role: "system",
              content:
                "Compare the answer against each supplied gold point. For every gold point decide: " +
                '"hit" if the answer conveys it, "missing" if the answer does not mention it, ' +
                '"contradicted" if the answer states something incompatible with it. ' +
                "Return one entry per gold point, in the same order, as strict JSON only.",
            },
            {
              role: "user",
              content: JSON.stringify({
                question: input.question,
                answer: input.answer,
                goldPoints: input.goldPoints,
              }),
            },
          ],
          { temperature: 0, structuredOutput: CORRECTNESS_OUTPUT },
        ),
      );
      return {
        output: parseJudgeOutput(response.content, CorrectnessOutputSchema),
        usage: response.usage,
      };
    });

    // 分母取模型实际返回的要点数（而非 input.goldPoints.length）：schema 已约束 ≤20 且
    // prompt 要求逐条对应；若模型少返回，按它给出的判定算，避免凭空把缺失项当"缺失"再罚一次。
    if (output.points.length === 0) {
      return { score: 0, evidence: ["Judge returned no point comparisons."], usage };
    }
    // 只有 hit 计入一致数——missing 与 contradicted 都不算（原型 §7 三态）。
    const hits = output.points.filter((p) => p.status === "hit").length;
    return {
      score: Math.round((hits / output.points.length) * 100),
      evidence: limitedEvidence(
        output.points.map((p) => `[${p.status}] ${p.point} —— ${p.reason}`),
        "No point evidence was returned.",
      ),
      usage,
    };
  }
}
