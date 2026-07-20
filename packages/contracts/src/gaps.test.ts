import { describe, expect, it } from "vitest";
import {
  DraftGoldRequestSchema,
  GapListQuerySchema,
  PromoteGapRequestSchema,
} from "./gaps";

const uuid = "11111111-1111-4111-8111-111111111111";
const otherUuid = "22222222-2222-4222-8222-222222222222";

describe("GapListQuerySchema", () => {
  it("caps offset so `1e30` cannot reach PG as a bigint literal", () => {
    expect(GapListQuerySchema.safeParse({ offset: "1e30" }).success).toBe(false);
  });
});

describe("DraftGoldRequestSchema", () => {
  it("trims the question and keeps answer optional", () => {
    const parsed = DraftGoldRequestSchema.parse({ question: "  能开专票吗  " });
    expect(parsed.question).toBe("能开专票吗");
    expect(parsed.answer).toBeUndefined();
  });
  it("rejects a whitespace-only question（trim 后为空）", () => {
    expect(DraftGoldRequestSchema.safeParse({ question: "   " }).success).toBe(false);
  });
  it("rejects a question over 500 chars（§19.1）", () => {
    expect(DraftGoldRequestSchema.safeParse({ question: "问".repeat(501) }).success).toBe(false);
  });
  it("rejects an answer over 5000 chars", () => {
    expect(
      DraftGoldRequestSchema.safeParse({ question: "能开专票吗", answer: "答".repeat(5001) })
        .success,
    ).toBe(false);
  });
});

describe("PromoteGapRequestSchema", () => {
  const item = (patch: Record<string, unknown> = {}) => ({
    itemId: otherUuid,
    goldPoints: ["7 天内无理由退"],
    ...patch,
  });
  const base = { clusterId: uuid, targetSetId: uuid, items: [item()] };

  it("accepts a minimal batch without per-item question override", () => {
    const parsed = PromoteGapRequestSchema.parse(base);
    expect(parsed.items[0].question).toBeUndefined();
  });
  it("allows empty goldPoints（草拟失败的行仍可入集，原型 :596）", () => {
    expect(PromoteGapRequestSchema.safeParse({ ...base, items: [item({ goldPoints: [] })] }).success)
      .toBe(true);
  });
  it("rejects an empty batch and a batch over 50", () => {
    expect(PromoteGapRequestSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(
      PromoteGapRequestSchema.safeParse({
        ...base,
        items: Array.from({ length: 51 }, () => item()),
      }).success,
    ).toBe(false);
  });
  it("rejects more than 10 gold points and a point over 200 chars（§19.1）", () => {
    expect(
      PromoteGapRequestSchema.safeParse({
        ...base,
        items: [item({ goldPoints: Array.from({ length: 11 }, () => "要点") })],
      }).success,
    ).toBe(false);
    expect(
      PromoteGapRequestSchema.safeParse({ ...base, items: [item({ goldPoints: ["点".repeat(201)] })] })
        .success,
    ).toBe(false);
  });
  it("rejects a whitespace-only question override（不能用空白绕过决策 G 的守卫）", () => {
    expect(PromoteGapRequestSchema.safeParse({ ...base, items: [item({ question: "   " })] }).success)
      .toBe(false);
  });
  it("rejects non-uuid ids", () => {
    expect(PromoteGapRequestSchema.safeParse({ ...base, clusterId: "not-a-uuid" }).success).toBe(
      false,
    );
    expect(
      PromoteGapRequestSchema.safeParse({ ...base, items: [item({ itemId: "nope" })] }).success,
    ).toBe(false);
  });
});
