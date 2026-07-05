import { ClickHouseTracesRepository } from "../src/modules/traces/clickhouse-traces.repository";
import type { CodeCrushClickHouseClient } from "../src/platform/clickhouse/clickhouse.types";

type QueryCall = { query: string };

function buildClient(opts: { tableExists: boolean; rows?: unknown[] }) {
  const queries: QueryCall[] = [];
  const commands: QueryCall[] = [];
  const client = {
    query: jest.fn(async ({ query }: QueryCall) => {
      queries.push({ query });
      if (query.startsWith("EXISTS TABLE")) {
        return { json: async () => [{ result: opts.tableExists ? 1 : 0 }] };
      }
      return { json: async () => opts.rows ?? [] };
    }),
    command: jest.fn(async (call: QueryCall) => {
      commands.push(call);
    }),
  };
  return { client: client as unknown as CodeCrushClickHouseClient, queries, commands, raw: client };
}

describe("ClickHouseTracesRepository", () => {
  it("returns empty spans without DDL when exporter table does not exist (cold DB)", async () => {
    const { client, raw } = buildClient({ tableExists: false });
    const repo = new ClickHouseTracesRepository(client);
    await expect(repo.findByTraceId("391dae938234560b16bb63f51501cb6f")).resolves.toEqual({
      traceId: "391dae938234560b16bb63f51501cb6f",
      spans: [],
    });
    expect(raw.command).not.toHaveBeenCalled();
  });

  it("creates the view once and caches readiness across reads", async () => {
    const { client, raw } = buildClient({
      tableExists: true,
      rows: [
        {
          trace_id: "391dae938234560b16bb63f51501cb6f",
          span_id: "6bb63f51501cb6f1",
          parent_span_id: null,
          name: "manual.hello",
          kind: "custom",
          start_time: "2026-07-05 08:00:00.123456789",
          duration_ms: 1.5,
          status_code: "Ok",
          attributes: { "codecrush.test": "hello" },
        },
      ],
    });
    const repo = new ClickHouseTracesRepository(client);

    const first = await repo.findByTraceId("391dae938234560b16bb63f51501cb6f");
    expect(first.spans[0]).toMatchObject({
      name: "manual.hello",
      parentSpanId: null,
      startTime: "2026-07-05T08:00:00.123Z", // UTC 毫秒 ISO（无本地时区偏移）
    });
    expect(raw.command).toHaveBeenCalledTimes(1);

    await repo.findByTraceId("391dae938234560b16bb63f51501cb6f");
    // 第二次读：viewsReady 缓存生效，不再 EXISTS 探测、不再执行 VIEW DDL
    expect(raw.command).toHaveBeenCalledTimes(1);
    const existsProbes = raw.query.mock.calls.filter(([arg]: [QueryCall]) =>
      arg.query.startsWith("EXISTS TABLE"),
    );
    expect(existsProbes).toHaveLength(1);
  });
});
