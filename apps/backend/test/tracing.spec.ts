import { emitManualHelloSpan } from "@codecrush/otel";
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

describe("backend telemetry package wiring", () => {
  it("can create a manual hello span identity without Docker", async () => {
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
    });
    trace.setGlobalTracerProvider(provider);
    const result = await emitManualHelloSpan();
    expect(result.name).toBe("manual.hello");
    expect(result.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(result.spanId).toMatch(/^[a-f0-9]{16}$/);
  });
});
