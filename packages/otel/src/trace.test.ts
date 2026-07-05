import { context, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";
import {
  emitManualHelloSpan,
  forceFlushTelemetry,
  resetTelemetryForTests,
  setForceFlushHookForTelemetry,
} from "./trace";

describe("manual hello span", () => {
  afterEach(() => {
    resetTelemetryForTests();
  });

  it("returns the trace and span identifiers from a real span", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);

    const result = await emitManualHelloSpan();

    expect(result.name).toBe("manual.hello");
    expect(result.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(result.spanId).toMatch(/^[a-f0-9]{16}$/);
    expect(exporter.getFinishedSpans().map((span) => span.name)).toContain("manual.hello");
    expect(trace.getSpan(context.active())).toBeUndefined();
  });

  it("does not throw when the flush hook rejects (collector unreachable)", async () => {
    setForceFlushHookForTelemetry(() => Promise.reject(new Error("connect ECONNREFUSED")));
    await expect(forceFlushTelemetry()).resolves.toBeUndefined();
    await expect(emitManualHelloSpan()).resolves.toMatchObject({ name: "manual.hello" });
  });
});
