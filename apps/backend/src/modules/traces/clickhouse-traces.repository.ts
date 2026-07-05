import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import type { TraceDetailResponse, TraceSpan } from "@codecrush/contracts";
import { CLICKHOUSE } from "../../platform/clickhouse/clickhouse.constants";
import type { CodeCrushClickHouseClient } from "../../platform/clickhouse/clickhouse.types";

export const TRACE_VIEW_NAME = "codecrush_trace_spans";
const TRACE_VIEW_SQL_RELPATH = join("infra", "clickhouse", "views", "001-trace-views.sql");

/**
 * 解析仓库根下的 VIEW SQL 路径。
 * 后端 `start` 经 `pnpm --filter @codecrush/backend start` 运行，cwd = apps/backend，
 * 直接用 process.cwd() 拼 infra/ 会指到 apps/backend/infra（不存在），所以从当前文件位置
 * 向上找 pnpm-workspace.yaml 标记的仓库根（dist 与 src 运行都成立）。
 */
function resolveTraceViewSqlPath(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return join(dir, TRACE_VIEW_SQL_RELPATH);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 兜底：cwd 相对（从仓库根启动时成立）
  return join(process.cwd(), TRACE_VIEW_SQL_RELPATH);
}

/**
 * ClickHouse DateTime64 经 JSONEachRow 默认返回 "YYYY-MM-DD hh:mm:ss[.fraction]"（UTC、无时区）。
 * 直接 `new Date(该串)` 会被当本地时区解析产生偏移；这里按 UTC 显式解析并规整到毫秒 ISO。
 */
function toIsoUtc(chTime: string): string {
  const m = chTime.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?/);
  if (!m) return new Date(chTime).toISOString();
  const frac = (m[3] ?? "").padEnd(3, "0").slice(0, 3);
  return new Date(`${m[1]}T${m[2]}.${frac}Z`).toISOString();
}

type ClickHouseTraceRow = {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  name: string;
  kind: string;
  start_time: string;
  duration_ms: number;
  status_code: string;
  attributes: Record<string, unknown>;
};

@Injectable()
export class ClickHouseTracesRepository {
  /** VIEW 已确认建好后置位，读路径不再重复 readFile + DDL（review P3-3） */
  private viewsReady = false;

  constructor(@Inject(CLICKHOUSE) private readonly clickhouse: CodeCrushClickHouseClient) {}

  private async exporterTableExists(): Promise<boolean> {
    const result = await this.clickhouse.query({
      query: "EXISTS TABLE otel_traces",
      format: "JSONEachRow",
    });
    const rows = await result.json<{ result: 0 | 1 }>();
    return rows[0]?.result === 1;
  }

  /**
   * 确保防腐 VIEW 存在。返回 false = exporter 还没建 otel_traces（冷库），
   * 调用方应返回空结果而不是等待/报错（review P3-3：原实现轮询 10s 后 500）。
   */
  async ensureTraceViews(): Promise<boolean> {
    if (this.viewsReady) return true;
    if (!(await this.exporterTableExists())) return false;
    const viewSql = await readFile(resolveTraceViewSqlPath(), "utf8");
    await this.clickhouse.command({ query: viewSql });
    this.viewsReady = true;
    return true;
  }

  async findByTraceId(traceId: string): Promise<TraceDetailResponse> {
    if (!(await this.ensureTraceViews())) {
      return { traceId, spans: [] };
    }
    const result = await this.clickhouse.query({
      query: `
        SELECT *
        FROM ${TRACE_VIEW_NAME}
        WHERE trace_id = {traceId:String}
        ORDER BY start_time ASC
      `,
      query_params: { traceId },
      format: "JSONEachRow",
    });
    const rows = await result.json<ClickHouseTraceRow>();
    return {
      traceId,
      spans: rows.map(
        (row): TraceSpan => ({
          traceId: row.trace_id,
          spanId: row.span_id,
          parentSpanId: row.parent_span_id || null,
          name: row.name,
          kind: row.kind,
          startTime: toIsoUtc(row.start_time),
          durationMs: Number(row.duration_ms),
          statusCode: row.status_code,
          attributes: row.attributes ?? {},
        }),
      ),
    };
  }
}
