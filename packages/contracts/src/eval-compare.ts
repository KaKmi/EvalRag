import { z } from "zod";
import { EvalRunListItemSchema, EvalVerdictSchema } from "./eval-runs";

const uuid = z.string().uuid();
const score = z.number().int().min(0).max(100);

/**
 * E-W2b F8 屏4 版本对比。8 个指标：4 个 LLM 判分 + citation + 3 个检索层 gold 指标。
 * a=基线（较早 run）、b=候选（较新 run），前端按 createdAt 自动排。
 */
export const CompareMetricKeySchema = z.enum([
  "faithfulness",
  "answerRelevancy",
  "contextPrecision",
  "correctness",
  "citation",
  "contextRecall",
  "ndcg5",
  "hitRate5",
]);
export type CompareMetricKey = z.infer<typeof CompareMetricKeySchema>;

/** 逐指标对比：delta=b−a（任一侧 null → null）；significant = |delta|≥3 且两侧 scoredCount≥30。 */
export const CompareMetricRowSchema = z.object({
  key: CompareMetricKeySchema,
  a: score.nullable(),
  b: score.nullable(),
  delta: z.number().nullable(),
  significant: z.boolean(),
});
export type CompareMetricRow = z.infer<typeof CompareMetricRowSchema>;

const CompareCaseSideSchema = z.object({
  verdict: EvalVerdictSchema,
  minScore: score.nullable(),
  scores: z.partialRecord(CompareMetricKeySchema, score.nullable()),
  answer: z.string(),
  traceId: z.string().nullable(),
});
export type CompareCaseSide = z.infer<typeof CompareCaseSideSchema>;

const CompareRunSummarySchema = EvalRunListItemSchema.extend({
  judgeModelId: uuid,
  offlineJudgeVersion: z.string(),
  tokensUsed: z.number().int().nonnegative(),
});

export const EvalCompareResponseSchema = z.object({
  a: CompareRunSummarySchema,
  b: CompareRunSummarySchema,
  metrics: z.array(CompareMetricRowSchema),
  latency: z.object({
    aP95Ms: z.number().int().nonnegative().nullable(),
    bP95Ms: z.number().int().nonnegative().nullable(),
  }),
  tokens: z.object({
    aAvgPerCase: z.number().int().nonnegative().nullable(),
    bAvgPerCase: z.number().int().nonnegative().nullable(),
  }),
  cases: z.array(
    z.object({
      caseId: uuid,
      seq: z.number().int().positive(),
      question: z.string(),
      a: CompareCaseSideSchema,
      b: CompareCaseSideSchema,
      regressed: z.boolean(),
      improved: z.boolean(),
    }),
  ),
  summary: z.object({
    overallDelta: z.number().nullable(),
    improvedCount: z.number().int().nonnegative(),
    regressedCount: z.number().int().nonnegative(),
    flatCount: z.number().int().nonnegative(),
    excludedCount: z.number().int().nonnegative(),
    judgeMismatch: z.boolean(),
  }),
});
export type EvalCompareResponse = z.infer<typeof EvalCompareResponseSchema>;

/** 409 body：两 run 题库版本集合不一致（前端渲染红条「结论不可比」）。 */
export const EvalCompareIncomparableSchema = z.object({ code: z.literal("incomparable") });
export type EvalCompareIncomparable = z.infer<typeof EvalCompareIncomparableSchema>;
