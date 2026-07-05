import { context, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";
import { emitManualHelloSpan, resetTelemetryForTests } from "./trace";

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
});
