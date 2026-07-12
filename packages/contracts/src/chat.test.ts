import { describe, expect, it } from "vitest";
import { ChatStreamEventSchema, FallbackReasonSchema } from "./chat";

describe("M8 done 事件富化", () => {
  it("done 事件带 coverage/isFallback/fallbackReasons 可 parse", () => {
    const e = {
      type: "done",
      traceId: "a".repeat(32),
      confidence: 0.9,
      coverage: "full",
      isFallback: false,
      fallbackReasons: [],
    };
    expect(() => ChatStreamEventSchema.parse(e)).not.toThrow();
  });

  it("兜底 done：isFallback=true + 原因枚举", () => {
    const e = {
      type: "done",
      traceId: "b".repeat(32),
      coverage: "partial",
      isFallback: true,
      fallbackReasons: ["low_similarity", "empty_retrieval"],
    };
    expect(() => ChatStreamEventSchema.parse(e)).not.toThrow();
    expect(() => FallbackReasonSchema.parse("out_of_scope")).not.toThrow();
    expect(() => FallbackReasonSchema.parse("handled_by_fallback")).not.toThrow();
    expect(() => FallbackReasonSchema.parse("bogus")).toThrow();
  });

  it("FallbackReason 含 chitchat（014：CHAT 闲聊直走兜底）", () => {
    expect(() => FallbackReasonSchema.parse("chitchat")).not.toThrow();
    const e = {
      type: "done",
      traceId: "c".repeat(32),
      coverage: "partial",
      isFallback: true,
      fallbackReasons: ["chitchat", "handled_by_fallback"],
    };
    expect(() => ChatStreamEventSchema.parse(e)).not.toThrow();
  });

  it("done 缺 coverage/isFallback/fallbackReasons 不合法（必填）", () => {
    expect(() => ChatStreamEventSchema.parse({ type: "done", traceId: "abc" })).toThrow();
  });
});
