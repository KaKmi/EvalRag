import { describe, expect, it } from "vitest";
import { MessageSchema } from "./conversations";

describe("M8 Message 派生字段", () => {
  it("assistant 消息带 coverage/isFallback/fallbackInfo（parse 后字段保留）", () => {
    const m = {
      id: "m1",
      convId: "c1",
      role: "assistant",
      content: "x",
      traceId: "t",
      confidence: 0.8,
      coverage: "full",
      isFallback: false,
      fallbackInfo: { reasons: [], topScore: 0.8 },
      citations: ["1"],
    };
    const parsed = MessageSchema.parse(m);
    expect(parsed.coverage).toBe("full");
    expect(parsed.isFallback).toBe(false);
    expect(parsed.fallbackInfo).toEqual({ reasons: [], topScore: 0.8 });
  });

  it("历史 user 消息无派生字段仍合法（全 optional）", () => {
    expect(() =>
      MessageSchema.parse({ id: "m0", convId: "c1", role: "user", content: "q" }),
    ).not.toThrow();
  });
});
