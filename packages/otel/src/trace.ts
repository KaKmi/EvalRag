import {
  context,
  SpanStatusCode,
  trace as otelTrace,
  type Context,
  type Span,
} from "@opentelemetry/api";
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
  // flush 是 best-effort：导出失败（如 Collector 不可达时 gRPC 快速 reject）不得向调用方抛错
  await Promise.race([
    forceFlushHook().catch(() => undefined),
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

export type ManualSpan = { span: Span; ctx: Context };

/**
 * 手动生命周期 span：创建但**不** end，返回 span 与其派生 context（供子阶段显式挂父）。
 * 跨 async generator 的 yield 边界承载根 / 流式 span 时用它——withSpan 会在回调 resolve
 * 瞬间 end，撑不住"边 yield 边保持打开"。调用方**必须**在 finally 里 span.end()。
 */
export function startManualSpan(
  name: string,
  options: { attributes?: SpanAttributes } | undefined,
  parentCtx?: Context,
): ManualSpan {
  const tracer = otelTrace.getTracer("codecrush");
  const base = parentCtx ?? context.active();
  const span = tracer.startSpan(name, { attributes: options?.attributes }, base);
  return { span, ctx: otelTrace.setSpan(base, span) };
}

/**
 * 在给定 context 内运行 fn（激活该 ctx），**不新建 span**。用于让下游模块自建的
 * withSpan 子 span（executeStructured / retrieval / streamText）显式挂到父 ctx，
 * 而无需改这些模块签名。对照 013 §4 的 runChild：本项目子步骤已各自建 span，
 * 编排只需激活父 ctx，不再套 wrapper span（避免瀑布图多一层）。
 */
export function runInContext<T>(ctx: Context, fn: () => Promise<T> | T): Promise<T> | T {
  return context.with(ctx, fn);
}

// re-export：让后端 src（node-runtime / 编排）只依赖 @codecrush/otel，不直接 import
// @opentelemetry/api（后者是 backend 的 devDependency，直接引入生产 src 有打包隐患；
// 且 spec D1 要求编排层只 import @codecrush/otel）。SpanStatusCode 是运行时 enum，须值导出。
export { SpanStatusCode } from "@opentelemetry/api";
export type { Context } from "@opentelemetry/api";

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
