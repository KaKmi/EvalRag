import { describe, expect, it } from "vitest";
import { HelloTraceResponseSchema, TraceDetailResponseSchema } from "./traces";

describe("trace contracts", () => {
  it("accepts a hello trace response", () => {
    expect(
      HelloTraceResponseSchema.parse({
        traceId: "391dae938234560b16bb63f51501cb6f",
        spanId: "6bb63f51501cb6f1",
        name: "manual.hello",
      }),
    ).toEqual({
      traceId: "391dae938234560b16bb63f51501cb6f",
      spanId: "6bb63f51501cb6f1",
      name: "manual.hello",
    });
  });

  it("accepts a normalized trace detail response", () => {
    const result = TraceDetailResponseSchema.safeParse({
      traceId: "391dae938234560b16bb63f51501cb6f",
      spans: [
        {
          traceId: "391dae938234560b16bb63f51501cb6f",
          spanId: "6bb63f51501cb6f1",
          parentSpanId: null,
          name: "manual.hello",
          kind: "custom",
          startTime: "2026-07-05T00:00:00.000Z",
          durationMs: 12.5,
          statusCode: "Ok",
          attributes: { "codecrush.test": "hello" },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed trace identifiers", () => {
    expect(
      HelloTraceResponseSchema.safeParse({
        traceId: "short",
        spanId: "also-short",
        name: "manual.hello",
      }).success,
    ).toBe(false);
  });
});
