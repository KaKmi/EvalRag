import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { ClickHouseEvaluationsRepository } from "../src/modules/evaluations/clickhouse-evaluations.repository";

const from = new Date("2026-07-08T00:00:00.000Z");
const to = new Date("2026-07-15T00:00:00.000Z");

function jsonResult<T>(rows: T[]) {
  return { json: async () => rows };
}

describe("ClickHouseEvaluationsRepository SQL", () => {
  it("overview first merges one latest row per target/version across all arrival minutes", async () => {
    const clickhouse = {
      command: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce(jsonResult([{ result: 1 }]))
        .mockResolvedValueOnce(jsonResult([{ count: "1" }]))
        .mockResolvedValueOnce(
          jsonResult([
            {
              sample_count: "1",
              faithfulness: 92,
              answer_relevancy: 85,
              context_precision: 78,
            },
          ]),
        ),
    };
    const repo = new ClickHouseEvaluationsRepository(clickhouse as never);
    await expect(repo.getOverview({ from, to, judgeVersion: "online-v1" })).resolves.toMatchObject({
      sampleCount: 1,
      faithfulness: 92,
    });

    const sql = clickhouse.query.mock.calls.at(-1)?.[0].query as string;
    expect(sql).toContain("argMaxMerge(faithfulness_state)");
    expect(sql).toContain("GROUP BY target_trace_id, judge_version");
    expect(sql).toContain("avg(faithfulness)");
    expect(sql).toContain("judge_version = {judgeVersion:String}");
  });

  it("reads failure details from error.type and error.message only", async () => {
    const clickhouse = {
      command: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce(jsonResult([{ result: 1 }]))
        .mockResolvedValueOnce(
          jsonResult([
            {
              failed_at: "2026-07-15 02:01:00.000000000",
              judge_version: "online-v1",
              error_type: " JudgeUnavailable ",
              error_message: " judge unavailable ",
            },
          ]),
        ),
    };
    const repo = new ClickHouseEvaluationsRepository(clickhouse as never);
    await expect(repo.getLatestFailure("f".repeat(32))).resolves.toMatchObject({
      judgeVersion: "online-v1",
      reason: "JudgeUnavailable: judge unavailable",
    });
    const sql = clickhouse.query.mock.calls.at(-1)?.[0].query as string;
    expect(sql).toContain("SpanAttributes['error.type']");
    expect(sql).toContain("SpanAttributes['error.message']");
    expect(sql).not.toContain("rag.eval.error");
  });
});

const enabled = process.env.RUN_CLICKHOUSE_TESTS === "1";
const describeClickHouse = enabled ? describe : describe.skip;
const target = "a".repeat(32);
const failedTarget = "f".repeat(32);

async function insertEvalSpan(
  client: ClickHouseClient,
  row: {
    target: string;
    at: string;
    version: string;
    status: "success" | "failed";
    score?: number;
  },
) {
  const attributes: Record<string, string> = {
    "rag.eval.target_trace_id": row.target,
    "rag.eval.version": row.version,
    "rag.eval.status": row.status,
    "gen_ai.agent.id": "agent-1",
    "gen_ai.request.model": "generation-1",
  };
  if (row.status === "success") {
    Object.assign(attributes, {
      "rag.eval.faithfulness": String(row.score),
      "rag.eval.answer_relevancy": String(row.score),
      "rag.eval.context_precision": String(row.score),
      "rag.eval.judge_model": "judge-1",
      "codecrush.io.output": JSON.stringify({
        faithfulness: ["grounded"],
        answerRelevancy: ["relevant"],
        contextPrecision: ["precise"],
      }),
    });
  } else {
    attributes["error.type"] = "JudgeUnavailable";
    attributes["error.message"] = "judge unavailable";
  }
  await client.insert({
    table: "otel_traces",
    format: "JSONEachRow",
    values: [
      {
        Timestamp: row.at,
        TraceId: row.target,
        SpanId: row.target.slice(0, 16),
        ParentSpanId: "",
        TraceState: "",
        SpanName: "rag.eval",
        SpanKind: "SPAN_KIND_INTERNAL",
        ServiceName: "codecrush-backend",
        ResourceAttributes: {},
        ScopeName: "rag-eval",
        ScopeVersion: "1",
        SpanAttributes: attributes,
        Duration: 0,
        StatusCode: "STATUS_CODE_OK",
        StatusMessage: "",
        Events: [],
        Links: [],
      },
    ],
    clickhouse_settings: { input_format_defaults_for_omitted_fields: 1 },
  });
}

describeClickHouse("evaluation read model", () => {
  let client: ClickHouseClient;
  let repository: ClickHouseEvaluationsRepository;

  beforeAll(async () => {
    client = createClient({ url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123" });
    repository = new ClickHouseEvaluationsRepository(client as never);
    await repository.getMinuteAggregates({
      from: "2026-07-15T00:00:00.000Z",
      to: "2026-07-15T00:01:00.000Z",
      judgeVersion: "online-v1",
    });
  });

  afterEach(async () => {
    await client.command({
      query: "ALTER TABLE otel_traces DELETE WHERE TraceId IN ({target:String},{failed:String})",
      query_params: { target, failed: failedTarget },
      clickhouse_settings: { mutations_sync: 2 },
    });
    await client.command({
      query:
        "ALTER TABLE codecrush_eval_targets DELETE WHERE target_trace_id IN ({target:String},{failed:String})",
      query_params: { target, failed: failedTarget },
      clickhouse_settings: { mutations_sync: 2 },
    });
  });

  afterAll(async () => client.close());

  it("deduplicates the same target/version across minute boundaries before bucketing", async () => {
    await insertEvalSpan(client, {
      target,
      at: "2026-07-15 01:59:59.000000000",
      version: "online-v1",
      status: "success",
      score: 40,
    });
    await insertEvalSpan(client, {
      target,
      at: "2026-07-15 02:00:01.000000000",
      version: "online-v1",
      status: "success",
      score: 90,
    });
    await insertEvalSpan(client, {
      target,
      at: "2026-07-15 02:00:02.000000000",
      version: "online-v0",
      status: "success",
      score: 10,
    });
    await repository.backfillForTest();

    await expect(
      repository.getMinuteAggregates({
        from: "2026-07-15T01:00:00.000Z",
        to: "2026-07-15T03:00:00.000Z",
        judgeVersion: "online-v1",
      }),
    ).resolves.toEqual([
      {
        bucket: "2026-07-15T02:00:00.000Z",
        sampleCount: 1,
        faithfulness: 90,
        answerRelevancy: 90,
        contextPrecision: 90,
      },
    ]);
  });

  it("excludes failed spans from success aggregates and exposes the latest failure", async () => {
    await insertEvalSpan(client, {
      target: failedTarget,
      at: "2026-07-15 02:01:00.000000000",
      version: "online-v1",
      status: "failed",
    });
    await repository.backfillForTest();

    await expect(
      repository.getMinuteAggregates({
        from: "2026-07-15T02:00:00.000Z",
        to: "2026-07-15T03:00:00.000Z",
        judgeVersion: "online-v1",
      }),
    ).resolves.toEqual([]);
    await expect(repository.getLatestFailure(failedTarget)).resolves.toMatchObject({
      judgeVersion: "online-v1",
      reason: "JudgeUnavailable: judge unavailable",
    });
  });
});
