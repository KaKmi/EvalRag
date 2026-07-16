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

const PointJudgmentSchema = z.strictObject({
  point: z.string().min(1).max(200),
  status: z.enum(["hit", "missing", "contradicted"]),
  reason: z.string().min(1).max(300),
});

@Injectable()
export class CorrectnessEvaluator {
  constructor(private readonly models: ModelsService) {}

  async score(input: CorrectnessInput, judgeModelId: string): Promise<MetricResult> {
    // 调用方（scoreOffline）保证 goldPoints 非空；防御性兜底：无 gold 无从比对，不调模型。
    if (input.goldPoints.length === 0) {
      return { score: 0, evidence: ["No gold points supplied."] };
    }

    // 分母**钉死为 gold 要点数**，不受模型摆布——与 context-precision.evaluator.ts:29-31
    // 的 `.length(input.contexts.length)` 同款。
    // 曾经的两个缺陷（peer review 抓出）都源于分母可变：
    //  ① `.max(20)` 无下限 → 模型回 `{points: []}` 也是合法响应 → 落到 `score: 0` 分支，
    //     等于把**裁判失败**写成 0 分（Global Constraints 明令禁止，必须记未评/NULL）；
    //  ② 分母取 `output.points.length` → 模型少回几条（恰恰是答案没覆盖、最该记 missing 的那几条）
    //     就能把 1 hit / 1 returned 算成 100 分——**系统性虚高**，且发生在本波的头号指标上。
    // 用 `.length(n)` 后，条数不符 = 解析失败 → withJudgeRetry 重试一次 → 仍败则抛 →
    // scoreOffline 的 allSettled 记 **null（未评）**，这才是正确语义。
    // 顺带解决：不再有固定 20 条上限（gold 要点数在契约里本就无上限）。
    const OutputSchema = z.strictObject({
      points: z.array(PointJudgmentSchema).length(input.goldPoints.length),
    });
    const outputSpec = structuredOutput("evaluation_correctness_v1", OutputSchema);

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
          { temperature: 0, structuredOutput: outputSpec },
        ),
      );
      return {
        output: parseJudgeOutput(response.content, OutputSchema),
        usage: response.usage,
      };
    });

    // 只有 hit 计入一致数——missing 与 contradicted 都不算（原型 §7 三态）。
    // 分母恒为 input.goldPoints.length（schema 已保证 output.points 与之等长）。
    const hits = output.points.filter((p) => p.status === "hit").length;
    return {
      score: Math.round((hits / input.goldPoints.length) * 100),
      evidence: limitedEvidence(
        output.points.map((p) => `[${p.status}] ${p.point} —— ${p.reason}`),
        "No point evidence was returned.",
      ),
      usage,
    };
  }
}
