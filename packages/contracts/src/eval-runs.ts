import { z } from "zod";

const isoString = z.string().datetime({ offset: true });
const uuid = z.string().uuid();
/** 逐指标分数：整数 0-100（原型 §7 逐用例表与记分卡均显示整数）。 */
const score = z.number().int().min(0).max(100);
/**
 * 综合分：**允许一位小数**——原型 §5「上次得分」显示 `82.0`。与 `EvalSet.lastRunScore`
 * 是同一个量（同一 run 的综合分），两处口径必须一致，故都不加 `.int()`。
 * 计算方与舍入规则见 eval-runs.service（Story 6）：四指标非空均值 → 四舍五入到一位小数。
 */
const overallScoreValue = z.number().min(0).max(100);

/** 原型 §18.A 状态机逐字对齐。 */
export const EvalRunStatusSchema = z.enum([
  "queued",
  "running",
  "done",
  "partial",
  "budget_stop",
  "failed",
]);
export type EvalRunStatus = z.infer<typeof EvalRunStatusSchema>;

/**
 * 原型 §7 判定：各指标最低档（<60 low / 60-79 weak / ≥80 pass）。
 * `timeout` = 单用例编排超时；`unscored` = 三个基础指标全 NULL（裁判全挂）。
 * 后两者不进 pass/weak/low 分母——原型未写全，018 §11 显式补全。
 */
export const EvalVerdictSchema = z.enum(["pass", "weak", "low", "timeout", "unscored"]);
export type EvalVerdict = z.infer<typeof EvalVerdictSchema>;

export const EvalMetricKeySchema = z.enum([
  "faithfulness",
  "answerRelevancy",
  "contextPrecision",
  "correctness",
]);
export type EvalMetricKey = z.infer<typeof EvalMetricKeySchema>;

/**
 * W2a scope：无 repeatCount。原型 §6 有该控件、§14 定义聚合口径为「取均值」(默认 1)，
 * 但 W2a 默认行为即 1，且加 repeat 维度要动 eval_run_results 唯一索引 → 与「范围」一并留 W2b
 * （018 已知缺口 3）。
 */
export const CreateEvalRunRequestSchema = z.object({
  setId: uuid,
  applicationId: uuid,
  configVersionId: uuid,
  judgeModelId: uuid,
  embeddingModelId: uuid,
  /** true = 跳过 1h 幂等复用检查（用户点「仍重新运行」）。 */
  force: z.boolean().default(false),
});
export type CreateEvalRunRequest = z.infer<typeof CreateEvalRunRequestSchema>;

export const EvalRunListItemSchema = z.object({
  id: uuid,
  setId: uuid,
  setName: z.string(),
  applicationId: uuid,
  configVersionId: uuid,
  configVersionLabel: z.string(),
  status: EvalRunStatusSchema,
  overallScore: overallScoreValue.nullable(),
  totalCases: z.number().int().nonnegative(),
  doneCases: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  createdAt: isoString,
});
export type EvalRunListItem = z.infer<typeof EvalRunListItemSchema>;

export const EvalRunListResponseSchema = z.array(EvalRunListItemSchema);
export type EvalRunListResponse = z.infer<typeof EvalRunListResponseSchema>;

/** 每个指标带覆盖率：avg 只按非 NULL 样本算，scoredCount/total 显性表达「未评」占比。 */
const metricAggregate = z.object({
  value: score.nullable(),
  scoredCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const EvalRunScorecardSchema = z.object({
  /** 检索层：W2a 只有 contextPrecision；recall/ndcg/hitRate 留 W2b（前端显示「—」+「未标 gold docs」）。 */
  retrieval: z.object({ contextPrecision: metricAggregate }),
  /** 生成层：W2a 三项；citation 留 W2b。 */
  generation: z.object({
    faithfulness: metricAggregate,
    answerRelevancy: metricAggregate,
    correctness: metricAggregate,
  }),
  passCount: z.number().int().nonnegative(),
  weakCount: z.number().int().nonnegative(),
  lowCount: z.number().int().nonnegative(),
  /** 超时/未评：不进 pass/weak/low 分母，但必须显性可见（018 已知取舍 2 的代价缓解）。 */
  timeoutCount: z.number().int().nonnegative(),
  unscoredCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
});
export type EvalRunScorecard = z.infer<typeof EvalRunScorecardSchema>;

export const EvalRunResultSchema = z.object({
  seq: z.number().int().positive(),
  caseId: uuid,
  caseVersion: z.number().int().positive(),
  question: z.string(),
  /** NULL = 未评（裁判失败/无 gold/超时）——绝不写 0（原型 §6）。 */
  faithfulness: score.nullable(),
  answerRelevancy: score.nullable(),
  contextPrecision: score.nullable(),
  correctness: score.nullable(),
  minMetric: EvalMetricKeySchema.nullable(),
  minScore: score.nullable(),
  verdict: EvalVerdictSchema,
  /**
   * partialRecord（非 record）：evidence 只收**评出来的**指标——未评指标没有 evidence 键。
   * Zod 4 的 z.record(enum, v) 是穷尽式的（`{}` 解析失败），与「单指标失败记 NULL」语义冲突。
   */
  evidence: z.partialRecord(EvalMetricKeySchema, z.array(z.string())),
  /** 「trace」链接目标；编排失败时为空。 */
  previewTraceId: z.string().nullable(),
  answer: z.string(),
  durationMs: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type EvalRunResult = z.infer<typeof EvalRunResultSchema>;

/** 未跑到的用例（stop/budget_stop 后剩余）——由 snapshot 减结果行推导，不写结果行。 */
export const EvalRunSkippedCaseSchema = z.object({
  seq: z.number().int().positive(),
  caseId: uuid,
  caseVersion: z.number().int().positive(),
  question: z.string(),
});
export type EvalRunSkippedCase = z.infer<typeof EvalRunSkippedCaseSchema>;

export const EvalRunReportSchema = z.object({
  run: EvalRunListItemSchema.extend({
    judgeModelId: uuid,
    offlineJudgeVersion: z.string(),
    tokenBudget: z.number().int().positive(),
    /** 决策 G：已知上报之和；provider 不回传 usage 时该项计 0 → 熔断偏松，不假装精确。 */
    tokensUsed: z.number().int().nonnegative(),
    startedAt: isoString.nullable(),
    finishedAt: isoString.nullable(),
    error: z.string().nullable(),
  }),
  scorecard: EvalRunScorecardSchema,
  results: z.array(EvalRunResultSchema),
  skipped: z.array(EvalRunSkippedCaseSchema),
});
export type EvalRunReport = z.infer<typeof EvalRunReportSchema>;

/** 1h 幂等：命中已有完成 run 时 409 body（前端弹「查看 / 仍重新运行」）。 */
export const RecentEvalRunConflictSchema = z.object({
  code: z.literal("recent_run_exists"),
  recentRunId: uuid,
});
export type RecentEvalRunConflict = z.infer<typeof RecentEvalRunConflictSchema>;
