import { describe, it, expect, vi } from "vitest";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { CODECRUSH_IO, CODECRUSH_REDACTED, RAG } from "@codecrush/otel-conventions";
import { redactPii, redactAttributes, RedactingSpanExporter } from "./redact";

describe("redactPii", () => {
  it("邮箱 → 占位，redacted=true", () => {
    const r = redactPii("联系 alice@example.com 处理");
    expect(r.text).toBe("联系 [REDACTED_EMAIL] 处理");
    expect(r.redacted).toBe(true);
  });

  it("中国大陆手机号 → 占位", () => {
    expect(redactPii("电话 13812345678").text).toBe("电话 [REDACTED_PHONE]");
  });

  it("18 位身份证（末位 X）→ 占位", () => {
    const r = redactPii("身份证 11010119900307461X");
    expect(r.text).toBe("身份证 [REDACTED_ID]");
    expect(r.redacted).toBe(true);
  });

  it("银行卡（Luhn 合法）→ 占位", () => {
    // 4111111111111111 = 标准 Visa 测试卡号，Luhn 合法
    const r = redactPii("卡号 4111111111111111 已绑定");
    expect(r.text).toBe("卡号 [REDACTED_CARD] 已绑定");
    expect(r.redacted).toBe(true);
  });

  it("13 位 Unix 毫秒时间戳（Luhn 不合法）→ 不脱敏（review Finding 1 防误伤）", () => {
    const r = redactPii("订单 1752396840000 已发货");
    expect(r.text).toBe("订单 1752396840000 已发货");
    expect(r.redacted).toBe(false);
  });

  it("13–19 位订单号（Luhn 不合法）→ 不脱敏", () => {
    // 780012345678901（15 位运单号，Luhn 不合法）
    expect(redactPii("运单号 780012345678901").redacted).toBe(false);
  });

  it("无 PII → 原样返回、redacted=false", () => {
    const r = redactPii("怎么退货");
    expect(r.text).toBe("怎么退货");
    expect(r.redacted).toBe(false);
  });

  it("多类 PII 同段 → 全部替换", () => {
    const r = redactPii("a@b.com 或 13800001111");
    expect(r.text).toBe("[REDACTED_EMAIL] 或 [REDACTED_PHONE]");
    expect(r.redacted).toBe(true);
  });
});

describe("redactAttributes", () => {
  it("就地 scrub 指定 key、返回 changed；非目标 key 不动", () => {
    const attrs: Record<string, unknown> = {
      [CODECRUSH_IO.INPUT]: "a@b.com",
      other: "a@b.com",
    };
    const changed = redactAttributes(attrs, [CODECRUSH_IO.INPUT]);
    expect(changed).toBe(true);
    expect(attrs[CODECRUSH_IO.INPUT]).toBe("[REDACTED_EMAIL]");
    expect(attrs.other).toBe("a@b.com");
  });

  it("无命中 → changed=false，值不变", () => {
    const attrs: Record<string, unknown> = { [CODECRUSH_IO.INPUT]: "干净文本" };
    expect(redactAttributes(attrs, [CODECRUSH_IO.INPUT])).toBe(false);
    expect(attrs[CODECRUSH_IO.INPUT]).toBe("干净文本");
  });

  it("非字符串值的 key 跳过（不抛）", () => {
    const attrs: Record<string, unknown> = { [CODECRUSH_IO.INPUT]: 42 };
    expect(redactAttributes(attrs, [CODECRUSH_IO.INPUT])).toBe(false);
  });
});

describe("RedactingSpanExporter", () => {
  const fakeSpan = (attrs: Record<string, unknown>) => ({ attributes: attrs }) as never;

  it("redacts PII inside rag.eval evidence stored in the standard output key", () => {
    const inner = { export: vi.fn((_spans, cb) => cb({ code: 0 })), shutdown: vi.fn() };
    const exporter = new RedactingSpanExporter(inner as never);
    const attributes: Record<string, unknown> = {
      [RAG.EVAL_STATUS]: "success",
      [CODECRUSH_IO.OUTPUT]: JSON.stringify({
        faithfulness: ["claim mentions alice@example.com"],
        contextPrecision: ["source contains 13800001111"],
      }),
    };
    exporter.export([fakeSpan(attributes)], vi.fn());
    expect(attributes[CODECRUSH_IO.OUTPUT]).toContain("[REDACTED_EMAIL]");
    expect(attributes[CODECRUSH_IO.OUTPUT]).toContain("[REDACTED_PHONE]");
    expect(attributes[CODECRUSH_REDACTED]).toBe(true);
  });

  it("export 前脱敏内容 key + 置 codecrush.redacted，再调 inner.export", () => {
    const inner = { export: vi.fn((_s, cb) => cb({ code: 0 })), shutdown: vi.fn() };
    const exp = new RedactingSpanExporter(inner as never, [CODECRUSH_IO.INPUT]);
    const attrs: Record<string, unknown> = { [CODECRUSH_IO.INPUT]: "a@b.com" };
    const cb = vi.fn();
    exp.export([fakeSpan(attrs)], cb);
    expect(attrs[CODECRUSH_IO.INPUT]).toBe("[REDACTED_EMAIL]");
    expect(attrs[CODECRUSH_REDACTED]).toBe(true);
    expect(inner.export).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({ code: 0 });
  });

  it("无 PII → 不置 redacted 标记，文本原样", () => {
    const inner = { export: vi.fn((_s, cb) => cb({ code: 0 })), shutdown: vi.fn() };
    const exp = new RedactingSpanExporter(inner as never, [CODECRUSH_IO.INPUT]);
    const attrs: Record<string, unknown> = { [CODECRUSH_IO.INPUT]: "怎么退货" };
    exp.export([fakeSpan(attrs)], vi.fn());
    expect(attrs[CODECRUSH_IO.INPUT]).toBe("怎么退货");
    expect(attrs[CODECRUSH_REDACTED]).toBeUndefined();
  });

  it("脱敏抛错被吞、仍调 inner.export（埋点不进关键路径）", () => {
    const inner = { export: vi.fn((_s, cb) => cb({ code: 0 })), shutdown: vi.fn() };
    const exp = new RedactingSpanExporter(inner as never, [CODECRUSH_IO.INPUT]);
    // attributes getter 抛错 → 脱敏 try/catch 吞掉
    const badSpan = {
      get attributes(): Record<string, unknown> {
        throw new Error("boom");
      },
    } as never;
    expect(() => exp.export([badSpan], vi.fn())).not.toThrow();
    expect(inner.export).toHaveBeenCalledOnce();
  });

  it("默认 key 集脱敏 io.input 与 io.output", () => {
    const inner = { export: vi.fn((_s, cb) => cb({ code: 0 })), shutdown: vi.fn() };
    const exp = new RedactingSpanExporter(inner as never); // 默认 DEFAULT_REDACT_KEYS
    const attrs: Record<string, unknown> = {
      [CODECRUSH_IO.INPUT]: "a@b.com",
      [CODECRUSH_IO.OUTPUT]: "回你 13800001111",
    };
    exp.export([fakeSpan(attrs)], vi.fn());
    expect(attrs[CODECRUSH_IO.INPUT]).toBe("[REDACTED_EMAIL]");
    expect(attrs[CODECRUSH_IO.OUTPUT]).toBe("回你 [REDACTED_PHONE]");
    expect(attrs[CODECRUSH_REDACTED]).toBe(true);
  });

  // review Finding 3：把「就地 mutate 落到导出」从一次性 spike 固化为回归测试——
  // 真实 SDK 管线 BasicTracerProvider → SimpleSpanProcessor → RedactingSpanExporter(inner)，
  // 断言 inner 收到的真实 ReadableSpan 属性已脱敏（防未来 SDK 冻结/克隆 attributes 致静默失效）。
  it("真实 SDK 管线：导出到底层 exporter 的 span 属性已脱敏 + 打标", async () => {
    const inner = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new RedactingSpanExporter(inner))],
    });
    const span = provider.getTracer("t").startSpan("rag.pipeline");
    span.setAttribute(RAG.EVAL_STATUS, "success");
    span.setAttribute(CODECRUSH_IO.INPUT, "我的邮箱 alice@example.com");
    span.setAttribute(CODECRUSH_IO.OUTPUT, "已记录");
    span.end();
    await provider.forceFlush();
    const got = inner.getFinishedSpans()[0];
    expect(got.attributes[CODECRUSH_IO.INPUT]).toBe("我的邮箱 [REDACTED_EMAIL]");
    expect(got.attributes[CODECRUSH_IO.OUTPUT]).toBe("已记录");
    expect(got.attributes[CODECRUSH_REDACTED]).toBe(true);
  });

  it("真实 SDK 管线脱敏 rag.eval evidence", async () => {
    const inner = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new RedactingSpanExporter(inner))],
    });
    const span = provider.getTracer("eval").startSpan("rag.eval");
    span.setAttribute(RAG.EVAL_STATUS, "success");
    span.setAttribute(
      CODECRUSH_IO.OUTPUT,
      JSON.stringify({ evidence: ["alice@example.com", "13800001111"] }),
    );
    span.end();
    await provider.forceFlush();
    const exported = String(inner.getFinishedSpans()[0]?.attributes[CODECRUSH_IO.OUTPUT]);
    expect(exported).toContain("[REDACTED_EMAIL]");
    expect(exported).toContain("[REDACTED_PHONE]");
  });
});
