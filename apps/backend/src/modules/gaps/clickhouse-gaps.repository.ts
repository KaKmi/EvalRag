import { Inject, Injectable } from "@nestjs/common";
import { CLICKHOUSE } from "../../platform/clickhouse/clickhouse.constants";
import type { CodeCrushClickHouseClient } from "../../platform/clickhouse/clickhouse.types";
import {
  loadSqlStatements,
  otelTracesTableExists,
  toIsoUtc,
} from "../../platform/clickhouse/clickhouse-view.utils";
import { POOL_CONFIDENCE_MAX, POOL_EVAL_SCORE_MAX } from "./gap.constants";

const TRACE_VIEW_SQL_RELPATH = "infra/clickhouse/views/001-trace-views.sql";
const EVAL_VIEW_SQL_RELPATH = "infra/clickhouse/views/003-eval-views.sql";

/**
 * judge-version 去重后的最新一次评分（口径与 `clickhouse-evaluations.repository.ts` 的
 * `LATEST_EVAL_SQL` 一致——同一条 trace 被多版判官评过时只取该版本的最后一次）。
 * `faithfulness` 的 -1 是「本次未评忠实度」的哨兵，必须还原成 NULL，不能当 0 分参与阈值比较。
 */
const LATEST_EVAL_SQL = `
  SELECT
    target_trace_id,
    judge_version,
    argMaxMerge(evaluated_at_state) AS evaluated_at,
    nullIf(argMaxMerge(faithfulness_state), -1) AS faithfulness,
    argMaxMerge(answer_relevancy_state) AS answer_relevancy,
    argMaxMerge(context_precision_state) AS context_precision
  FROM codecrush_eval_targets
  GROUP BY target_trace_id, judge_version
`;

/**
 * 改写后的问题取自 rewrite 子 span（决策 G）。
 *
 * 用**既有**的 `codecrush_trace_spans` 视图——它已把每个 span 的完整 `SpanAttributes`
 * 投影为 `attributes`，所以不需要（本波也不允许）新建任何视图。
 * `rag.node.name = 'rewrite'` 已在真库上核对过：实际取值就是 `rewrite`。
 *
 * ⚠️ 已知局限：当前 rewrite 节点 span **没有**发 `codecrush.io.output`
 * （`codecrush.io.output` 目前只打在 chain 根 span 与 rag.eval span 上），
 * 故本子查询在现网数据上恒返回空串 ⇒ `rewrittenQuestion` 恒为 null
 * ⇒ 应用层判为「指代未消解」。写成这个形状而非删掉，是因为结构本身是对的：
 * 一旦 rewrite 节点补上 output 埋点（orchestration 的 `spanEnrich` 机制已支持），
 * 这里无需改一个字就自动生效。
 */
const REWRITE_SPAN_SQL = `
  SELECT
    trace_id,
    JSONExtractString(argMax(attributes['codecrush.io.output'], start_time), 'rewrittenQuery')
      AS rewritten_question
  FROM codecrush_trace_spans
  WHERE attributes['rag.node.name'] = 'rewrite'
  GROUP BY trace_id
`;

export interface GapPoolCursor {
  lastTs: Date;
  lastTraceId: string;
}

export interface PoolCandidate {
  traceId: string;
  question: string;
  rewrittenQuestion: string | null;
  startTime: string;
  sessionId: string;
  isFirstTurnInSession: boolean;
  confidence: number | null;
  fallbackUsed: boolean;
  noCitations: boolean;
  faithfulness: number | null;
  answerRelevancy: number | null;
  contextPrecision: number | null;
}

type CandidateRow = {
  trace_id: string;
  question: string;
  rewritten_question: string | null;
  start_time: string;
  session_id: string;
  is_first_turn: number | boolean | string;
  confidence: number | string | null;
  // 视图里**没有** fallback_used 列，兜底折在 status 里；别名刻意避开这个名字，
  // 免得后来的人以为可以直接 `SELECT fallback_used`。
  is_fallback: number | boolean | string;
  no_citations: number | boolean | string;
  faithfulness: number | string | null;
  answer_relevancy: number | string | null;
  context_precision: number | string | null;
};

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function nullableNumber(value: number | string | null): number | null {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toClickHouseDateTime(value: Date): string {
  return value.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * 单位换算：`POOL_CONFIDENCE_MAX` 沿用原型 `:378` 的百分制（「可信度 <60」），
 * 但 `rag.quality.confidence` 落的是 **0–1**——`deriveConfidence` 就是取召回分的
 * `Math.max`（`chat/derived-metrics.ts:11`），真库实测 39 条 trace 里 13 条有值、
 * 全落在 0.20–0.94，`avg = 0.7`。
 *
 * 若直接拿 0–1 的列去比 60，**每一条埋了可信度的 trace 都恒 <60** ⇒ 问题池被灌满。
 * 这与 `OrNull` 想拦的是同一类事故，只是走的是「量纲不一致」这条路。
 * 换算放在这里而不是改常量：常量是产品语义（百分制阈值，将来要上设置面板），
 * 0–1 是遥测的实现细节，二者的接缝就在本 repository。
 */
function toTelemetryConfidenceScale(percentThreshold: number): number {
  return percentThreshold / 100;
}

function toCandidate(row: CandidateRow): PoolCandidate {
  const rewritten = (row.rewritten_question ?? "").trim();
  return {
    traceId: row.trace_id,
    question: row.question ?? "",
    // 空串与解析失败一律 null——「改写没取到」和「改写成了空」在下游是同一件事：未消解。
    rewrittenQuestion: rewritten === "" ? null : rewritten,
    startTime: toIsoUtc(row.start_time),
    sessionId: row.session_id ?? "",
    isFirstTurnInSession: truthy(row.is_first_turn),
    confidence: nullableNumber(row.confidence),
    fallbackUsed: truthy(row.is_fallback),
    noCitations: truthy(row.no_citations),
    faithfulness: nullableNumber(row.faithfulness),
    answerRelevancy: nullableNumber(row.answer_relevancy),
    contextPrecision: nullableNumber(row.context_precision),
  };
}

/**
 * 问题池收集器的取数口径（021 §10 / 决策 G）。
 *
 * 与 evaluations 域一样自持一个 CH repository，而不是 `gaps → traces`：
 * 跨域只走各自的读模型，见 `003`「E-W1 evaluations 域边界」。
 */
@Injectable()
export class ClickHouseGapsRepository {
  private evalViewsReady = false;

  constructor(@Inject(CLICKHOUSE) private readonly clickhouse: CodeCrushClickHouseClient) {}

  private async ensureViews(): Promise<boolean> {
    if (this.evalViewsReady) return true;
    if (!(await otelTracesTableExists(this.clickhouse))) return false;
    for (const relPath of [TRACE_VIEW_SQL_RELPATH, EVAL_VIEW_SQL_RELPATH]) {
      for (const statement of await loadSqlStatements(relPath)) {
        await this.clickhouse.command({ query: statement });
      }
    }
    this.evalViewsReady = true;
    return true;
  }

  /**
   * 按游标向前扫一页入池候选。
   *
   * 谓词上的几个非显然取舍：
   * - `t.preview = 0` **显式写死**（Global Constraint 10）。不能靠「只有在线 trace 才有 rag.eval
   *   span」这条间接性质——入池阈值里 `status='fallback'` / `no_citations` 两支根本不经过 eval，
   *   一条预览重放的兜底 trace 会直接漏进池子。
   * - `t.confidence IS NOT NULL` 必须在 `<` 之前：没埋到可信度的 trace **不是**低可信度。
   *   （视图侧用 `toFloat64OrNull` 同理——落 0 会把每条没埋点的 trace 判成 <60。）
   * - `ifNull(latest.faithfulness, 101)` 是「未评忠实度」的哨兵：101 恒大于任何阈值，
   *   于是 `least(...)` 只在真的评过的维度上取最小，未评的维度不会假装成 0 分把 trace 拉进池。
   * - 严格元组游标 + `ORDER BY` 同键：保证游标单调前进，同一秒内的多条 trace 不会被跳过或重放。
   */
  async listPoolCandidates(
    cursor: GapPoolCursor,
    upperBound: Date,
    judgeVersion: string,
    limit: number,
  ): Promise<PoolCandidate[]> {
    if (!(await this.ensureViews())) return [];
    const result = await this.clickhouse.query({
      query: `
        SELECT
          t.trace_id AS trace_id,
          t.user_input AS question,
          rw.rewritten_question AS rewritten_question,
          t.start_time AS start_time,
          t.session_id AS session_id,
          (t.session_id = '' OR t.start_time = firstTurn.first_ts) AS is_first_turn,
          t.confidence AS confidence,
          t.status = 'fallback' AS is_fallback,
          t.no_citations AS no_citations,
          latest.faithfulness AS faithfulness,
          latest.answer_relevancy AS answer_relevancy,
          latest.context_precision AS context_precision
        FROM codecrush_traces AS t
        LEFT JOIN (${LATEST_EVAL_SQL}) AS latest
          ON t.trace_id = latest.target_trace_id
          AND latest.judge_version = {judgeVersion:String}
        LEFT JOIN (${REWRITE_SPAN_SQL}) AS rw ON rw.trace_id = t.trace_id
        LEFT JOIN (
          SELECT session_id, min(start_time) AS first_ts
          FROM codecrush_traces
          WHERE preview = 0 AND session_id != ''
          GROUP BY session_id
        ) AS firstTurn ON firstTurn.session_id = t.session_id
        WHERE t.preview = 0
          AND (t.start_time, t.trace_id) > ({lastTs:DateTime64(9)}, {lastTraceId:String})
          AND t.start_time <= {upperBound:DateTime64(9)}
          AND (
            (t.confidence IS NOT NULL AND t.confidence < {confidenceMax:Float64})
            OR t.status = 'fallback'
            OR t.no_citations = 1
            OR least(
                 ifNull(latest.faithfulness, 101),
                 latest.answer_relevancy,
                 latest.context_precision
               ) < {evalMax:Float64}
          )
        ORDER BY t.start_time ASC, t.trace_id ASC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        lastTs: toClickHouseDateTime(cursor.lastTs),
        lastTraceId: cursor.lastTraceId,
        upperBound: toClickHouseDateTime(upperBound),
        judgeVersion,
        confidenceMax: toTelemetryConfidenceScale(POOL_CONFIDENCE_MAX),
        evalMax: POOL_EVAL_SCORE_MAX,
        limit,
      },
      format: "JSONEachRow",
    });
    const rows = await result.json<CandidateRow>();
    return rows.map(toCandidate);
  }
}
