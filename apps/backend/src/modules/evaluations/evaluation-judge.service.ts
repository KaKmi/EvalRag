import { Injectable, Logger, Optional } from "@nestjs/common";
import { AnswerRelevancyEvaluator } from "./answer-relevancy.evaluator";
import { ContextPrecisionEvaluator } from "./context-precision.evaluator";
import { CorrectnessEvaluator } from "./correctness.evaluator";
import type {
  EvaluationInput,
  EvaluationModelIds,
  EvaluationScores,
  MetricResult,
  OfflineEvaluationScores,
  TokenUsage,
} from "./evaluation.types";
import { FaithfulnessEvaluator } from "./faithfulness.evaluator";

@Injectable()
export class EvaluationJudgeService {
  private readonly logger = new Logger(EvaluationJudgeService.name);

  constructor(
    private readonly faithfulness: FaithfulnessEvaluator,
    private readonly answerRelevancy: AnswerRelevancyEvaluator,
    private readonly contextPrecision: ContextPrecisionEvaluator,
    /**
     * 018 决策 D：第 4 参**必须** `@Optional()` 且追加在末尾。
     * 两个 E-W1 测试正位构造本 service 且只传 3 参（`evaluation-judge.spec.ts:30`、
     * `evaluations.e2e.spec.ts:270-274`）；若此参必需，它们编译失败，直接违反
     * 验收标准「E-W1 测试原样通过」。运行时 DI 恒注入（evaluations.module.ts 的 providers 有它）。
     */
    @Optional() private readonly correctness?: CorrectnessEvaluator,
  ) {}

  /**
   * 在线判分（E-W1 基线，017:39 的**整体失败**不变式）：三个 await 顺序执行、无 try/catch，
   * 任一 evaluator 抛错整条 evaluation 失败，不聚合部分分数。
   *
   * ⚠️ **一行不许动**（Global Constraints）。离线的单指标隔离语义与此**相反**，
   * 故 `scoreOffline` 绝不复用本方法——见其 docstring。
   */
  async score(input: EvaluationInput, modelIds: EvaluationModelIds): Promise<EvaluationScores> {
    const faithfulness = await this.faithfulness.score(input, modelIds.judgeModelId);
    const answerRelevancy = await this.answerRelevancy.score(input, modelIds);
    const contextPrecision = await this.contextPrecision.score(input, modelIds.judgeModelId);
    return {
      faithfulness: faithfulness.score,
      answerRelevancy: answerRelevancy.score,
      contextPrecision: contextPrecision.score,
      evidence: {
        faithfulness: faithfulness.evidence,
        answerRelevancy: answerRelevancy.evidence,
        contextPrecision: contextPrecision.evidence,
      },
    };
  }

  /**
   * 离线判分（018 决策 D）：**单指标隔离**——原型 §6「单指标裁判调用失败重试 1 次，
   * 仍失败该指标记『未评』(不记 0 分)」，且不拖累其余指标。
   *
   * 与 `score()` 的语义**相反**，故**不复用**它（复用会让任一失败拖垮整条）：
   * 这里对 4 个 evaluator 各自 `Promise.allSettled`。重试由 evaluator 内部的
   * `withJudgeRetry` 负责（MAX_ATTEMPTS=2 = 首次 + 重试一次），run 引擎不重复实现。
   *
   * @param goldPoints 空数组 → 不调 correctness（无 gold 无从比对），该指标记 null。
   */
  async scoreOffline(
    input: EvaluationInput,
    modelIds: EvaluationModelIds,
    goldPoints: string[],
  ): Promise<OfflineEvaluationScores> {
    const wantsCorrectness = goldPoints.length > 0 && this.correctness !== undefined;

    const settled = await Promise.allSettled([
      this.faithfulness.score(input, modelIds.judgeModelId),
      this.answerRelevancy.score(input, modelIds),
      this.contextPrecision.score(input, modelIds.judgeModelId),
      wantsCorrectness
        ? this.correctness!.score({ ...input, goldPoints }, modelIds.judgeModelId)
        : Promise.resolve(null),
    ]);

    const keys = ["faithfulness", "answerRelevancy", "contextPrecision", "correctness"] as const;
    const scores: Record<string, number | null> = {};
    const evidence: Record<string, string[]> = {};
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    settled.forEach((outcome, index) => {
      const key = keys[index];
      // rejected（裁判重试后仍失败）→ null。**绝不写 0**（原型 §6：不拉低均值）。
      if (outcome.status !== "fulfilled" || outcome.value === null) {
        scores[key] = null;
        // QA recheck P2：原先这里静默丢弃 reason —— 全场 NULL 遍地却 0 条 warn/error，
        // 生产上裁判为何失败完全不可见（"未评"在报告里长得像"这题没测"，排查无从下手）。
        // 只记原因，不改 NULL 语义。value===null 是「无 gold 不调 correctness」的正常路径，不记。
        if (outcome.status === "rejected") {
          const reason = outcome.reason as Error | undefined;
          this.logger.warn(
            `裁判指标 ${key} 重试后仍失败，记未评（trace=${input.targetTraceId}）：${reason?.message ?? String(outcome.reason)}`,
          );
        }
        return;
      }
      const result = outcome.value as MetricResult;
      scores[key] = result.score;
      evidence[key] = result.evidence;
      // 决策 G：只累加已上报的部分；provider 不回传 usage 时该项计 0，不猜、不估算。
      if (result.usage) {
        usage.inputTokens += result.usage.inputTokens;
        usage.outputTokens += result.usage.outputTokens;
      }
    });

    return {
      faithfulness: scores.faithfulness,
      answerRelevancy: scores.answerRelevancy,
      contextPrecision: scores.contextPrecision,
      correctness: scores.correctness,
      evidence,
      usage,
    };
  }
}
