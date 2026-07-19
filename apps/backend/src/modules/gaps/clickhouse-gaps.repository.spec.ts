import { ClickHouseGapsRepository } from "./clickhouse-gaps.repository";
import type { CodeCrushClickHouseClient } from "../../platform/clickhouse/clickhouse.types";

type Captured = { query: string; query_params: Record<string, unknown> };

/**
 * 不连真 CH——这些断言钉的是**生成出来的 SQL 文本**。
 * 理由：入池谓词漏掉任意一条（`preview = 0`、游标严格元组、`confidence IS NOT NULL` 前置）
 * 都不会报错，只会静默污染问题池；只有对 SQL 本身下断言才拦得住。
 */
function makeRepo(): { repo: ClickHouseGapsRepository; captured: () => Captured } {
  let last: Captured | undefined;
  const fake = {
    query: async (args: Captured & { format?: string }) => {
      // EXISTS TABLE otel_traces 探测 / view 就绪查询不算候选查询，不覆盖 last。
      if (args.query.trim().startsWith("EXISTS TABLE")) {
        return { json: async () => [{ result: 1 }] };
      }
      last = { query: args.query, query_params: args.query_params ?? {} };
      return { json: async () => [] };
    },
    command: async () => undefined,
  } as unknown as CodeCrushClickHouseClient;

  return {
    repo: new ClickHouseGapsRepository(fake),
    captured: () => {
      if (!last) throw new Error("no candidate query captured");
      return last;
    },
  };
}

describe("ClickHouseGapsRepository.listPoolCandidates", () => {
  let captured: Captured;
  let flat: string;

  beforeAll(async () => {
    const { repo, captured: get } = makeRepo();
    await repo.listPoolCandidates(
      { lastTs: new Date("2026-07-01T00:00:00.000Z"), lastTraceId: "trace-a" },
      new Date("2026-07-19T00:00:00.000Z"),
      "online-v2",
      100,
    );
    captured = get();
    flat = captured.query.replace(/\s+/g, " ");
  });

  it("always filters preview traces out", () => {
    expect(captured.query).toMatch(/preview\s*=\s*0/);
  });

  it("binds judge_version rather than interpolating", () => {
    expect(captured.query).toContain("{judgeVersion:String}");
    expect(captured.query).not.toContain("online-v2");
    expect(captured.query_params.judgeVersion).toBe("online-v2");
  });

  it("uses a strict tuple cursor on (start_time, trace_id)", () => {
    expect(flat).toMatch(
      /\(\s*t\.start_time\s*,\s*t\.trace_id\s*\)\s*>\s*\(\s*\{lastTs:DateTime64\(9\)\}\s*,\s*\{lastTraceId:String\}\s*\)/,
    );
  });

  it("bounds the scan by upperBound", () => {
    expect(captured.query).toContain("t.start_time <= {upperBound:DateTime64(9)}");
  });

  it("orders by the cursor key so the cursor can advance monotonically", () => {
    expect(flat).toMatch(/ORDER BY t\.start_time\s*(ASC)?\s*,\s*t\.trace_id/);
  });

  it("uses status='fallback' for 兜底 and never references a non-existent fallback_used column", () => {
    expect(captured.query).toContain("t.status = 'fallback'");
    expect(captured.query).not.toContain("fallback_used");
  });

  it("guards confidence with IS NOT NULL before comparing it", () => {
    expect(flat).toMatch(
      /t\.confidence IS NOT NULL AND t\.confidence\s*<\s*\{confidenceMax:Float64\}/,
    );
  });

  it("binds both entry thresholds as query params", () => {
    expect(captured.query).toContain("{evalMax:Float64}");
    expect(captured.query).toContain("{confidenceMax:Float64}");
    expect(captured.query_params.evalMax).toBe(70);
  });

  /**
   * 量纲回归：常量是百分制（<60），但 `rag.quality.confidence` 落的是 0–1
   * （`deriveConfidence` = 召回分 max）。绑成 60 会让每条埋了可信度的 trace 恒命中入池，
   * 把问题池灌满——真库 39 条里 13 条有值，全在 0.20–0.94。
   */
  it("converts the percent-scale confidence threshold to the 0-1 telemetry scale", () => {
    expect(captured.query_params.confidenceMax).toBeCloseTo(0.6, 10);
  });

  it("reads the rewritten question from the existing codecrush_trace_spans view", () => {
    expect(captured.query).toContain("codecrush_trace_spans");
    expect(captured.query).toContain("attributes['rag.node.name'] = 'rewrite'");
    expect(captured.query).toContain("rewrittenQuery");
    // 本 story 只允许给 codecrush_traces 追加一个投影列，不得新建任何视图/表。
    expect(captured.query).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?(VIEW|TABLE)/i);
  });

  it("treats an empty session_id as a first turn", () => {
    expect(captured.query).toContain("t.session_id = ''");
  });

  it("bounds the page size with a bound limit param", () => {
    expect(captured.query).toContain("LIMIT {limit:UInt32}");
    expect(captured.query_params.limit).toBe(100);
  });
});
