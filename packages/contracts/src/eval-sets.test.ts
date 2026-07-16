import { describe, expect, it } from "vitest";
import {
  CreateEvalSetRequestSchema,
  CreateEvalCaseRequestSchema,
  ImportEvalCasesRequestSchema,
} from "./eval-sets";

describe("CreateEvalSetRequestSchema", () => {
  it("accepts a 1-50 char name", () => {
    expect(CreateEvalSetRequestSchema.parse({ name: "售后核心 50 题" }).name).toBe("售后核心 50 题");
  });
  it("rejects empty and >50 char names", () => {
    expect(CreateEvalSetRequestSchema.safeParse({ name: "" }).success).toBe(false);
    expect(CreateEvalSetRequestSchema.safeParse({ name: "x".repeat(51) }).success).toBe(false);
  });
});

describe("CreateEvalCaseRequestSchema", () => {
  it("accepts a case without gold points (draft)", () => {
    const parsed = CreateEvalCaseRequestSchema.parse({ question: "课程可以退款吗" });
    expect(parsed.goldPoints).toEqual([]);
  });
  it("rejects question >500 chars", () => {
    expect(CreateEvalCaseRequestSchema.safeParse({ question: "x".repeat(501) }).success).toBe(false);
  });
  it("rejects a gold point >200 chars", () => {
    expect(
      CreateEvalCaseRequestSchema.safeParse({ question: "q", goldPoints: ["x".repeat(201)] }).success,
    ).toBe(false);
  });
  it("rejects >10 gold docs and >5 tags", () => {
    expect(
      CreateEvalCaseRequestSchema.safeParse({
        question: "q",
        goldDocIds: Array.from({ length: 11 }, () => "11111111-1111-4111-8111-111111111111"),
      }).success,
    ).toBe(false);
    expect(
      CreateEvalCaseRequestSchema.safeParse({ question: "q", tags: ["a", "b", "c", "d", "e", "f"] })
        .success,
    ).toBe(false);
  });
  it("rejects a tag longer than 12 chars", () => {
    expect(
      CreateEvalCaseRequestSchema.safeParse({ question: "q", tags: ["x".repeat(13)] }).success,
    ).toBe(false);
  });
});

describe("ImportEvalCasesRequestSchema", () => {
  it("rejects more than 1000 rows", () => {
    const rows = Array.from({ length: 1001 }, () => ({ question: "q", goldAnswer: "a" }));
    expect(ImportEvalCasesRequestSchema.safeParse({ rows }).success).toBe(false);
  });
  it("accepts exactly 1000 rows", () => {
    const rows = Array.from({ length: 1000 }, () => ({ question: "q", goldAnswer: "a" }));
    expect(ImportEvalCasesRequestSchema.safeParse({ rows }).success).toBe(true);
  });
});
