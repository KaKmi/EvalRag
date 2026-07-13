import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
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
  runInContext,
  setForceFlushHookForTelemetry,
  startManualSpan,
  withSpan,
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

describe("startManualSpan / runInContext（generator 友好原语）", () => {
  afterEach(() => {
    resetTelemetryForTests();
    context.disable(); // 复位全局 ContextManager，避免跨用例/跨文件泄漏
  });

  function withExporter() {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    trace.disable(); // 关键：@opentelemetry/api 拒绝重复注册全局 provider（同文件前一个 describe 已注册）；
    trace.setGlobalTracerProvider(provider); // disable 后才能换成本 describe 的 exporter，否则捕不到 span
    // runInContext = context.with，需真实 ContextManager 才生效（默认 Noop 下 context.with 无效）；
    // 生产由 sdk-node 注册 AsyncLocalStorage，测试里手动注册以验证子 span 经活动上下文挂父。
    context.disable();
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    return exporter;
  }

  it("startManualSpan 不自动 end；显式 end() 后才导出", () => {
    const exporter = withExporter();
    const { span } = startManualSpan("t.manual", { attributes: { k: "v" } });
    expect(exporter.getFinishedSpans()).toHaveLength(0); // 未 end 不导出
    span.end();
    const spans = exporter.getFinishedSpans();
    expect(spans.map((s) => s.name)).toContain("t.manual");
    expect(spans[0].attributes.k).toBe("v");
  });

  it("子 span 用返回的 ctx 显式挂父：parent == manual span", () => {
    const exporter = withExporter();
    const { span: parent, ctx } = startManualSpan("t.parent", undefined);
    const child = trace.getTracer("codecrush").startSpan("t.child", undefined, ctx);
    child.end();
    parent.end();
    const finished = exporter.getFinishedSpans();
    const c = finished.find((s) => s.name === "t.child")!;
    expect(c.parentSpanContext?.spanId ?? (c as unknown as { parentSpanId?: string }).parentSpanId).toBe(
      parent.spanContext().spanId,
    );
    expect(c.spanContext().traceId).toBe(parent.spanContext().traceId);
  });

  it("runInContext 在给定 ctx 内激活父：其中自建的 withSpan 子 span 挂到该父", async () => {
    const exporter = withExporter();
    const { span: parent, ctx } = startManualSpan("t.root", undefined);
    await runInContext(ctx, () => withSpan("t.inner", undefined, () => "ok"));
    parent.end();
    const finished = exporter.getFinishedSpans();
    const inner = finished.find((s) => s.name === "t.inner")!;
    const pid = inner.parentSpanContext?.spanId ?? (inner as unknown as { parentSpanId?: string }).parentSpanId;
    expect(pid).toBe(parent.spanContext().spanId);
  });
});
