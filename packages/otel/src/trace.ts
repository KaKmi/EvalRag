import { SpanStatusCode, trace as otelTrace, type Span } from "@opentelemetry/api";
import { CODECRUSH_SPAN_KIND, OTEL_OPERATIONS } from "@codecrush/otel-conventions";

export type SpanAttributes = Record<
  string,
  string | number | boolean | string[] | number[] | boolean[]
>;
export type SpanIdentity = {
  traceId: string;
  spanId: string;
  name: string;
};

let forceFlushHook: (() => Promise<void>) | undefined;

export function setForceFlushHookForTelemetry(hook: (() => Promise<void>) | undefined): void {
  forceFlushHook = hook;
}

export function resetTelemetryForTests(): void {
  forceFlushHook = undefined;
}

export async function forceFlushTelemetry(timeoutMs = 2000): Promise<void> {
  if (!forceFlushHook) return;
  await Promise.race([
    forceFlushHook(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

export async function withSpan<T>(
  name: string,
  options: { attributes?: SpanAttributes } | undefined,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  const tracer = otelTrace.getTracer("codecrush");
  return await tracer.startActiveSpan(name, { attributes: options?.attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}

export async function emitManualHelloSpan(): Promise<SpanIdentity> {
  const result = await withSpan(
    "manual.hello",
    {
      attributes: {
        "codecrush.span.kind": CODECRUSH_SPAN_KIND.CUSTOM,
        "codecrush.test": "hello",
        "gen_ai.operation.name": OTEL_OPERATIONS.CUSTOM,
      },
    },
    (span) => {
      const spanContext = span.spanContext();
      return {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        name: "manual.hello" as const,
      };
    },
  );
  await forceFlushTelemetry();
  return result;
}
