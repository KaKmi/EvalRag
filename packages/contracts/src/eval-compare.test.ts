import { describe, expect, it } from "vitest";
import {
  CompareMetricKeySchema,
  EvalCompareResponseSchema,
  EvalCompareIncomparableSchema,
} from "./eval-compare";

const uuid = "11111111-1111-4111-8111-111111111111";

const runSummary = {
  id: uuid,
  setId: uuid,
  setName: "售后核心 50 题",
  applicationId: uuid,
  configVersionId: uuid,
  configVersionLabel: "v3",
  status: "done" as const,
  overallScore: 82,
  totalCases: 2,
  doneCases: 2,
  repeatCount: 1,
  durationMs: 1000,
  createdAt: "2026-07-13T09:11:00.000Z",
  judgeModelId: uuid,
  offlineJudgeVersion: "offline-v2",
  tokensUsed: 1234,
};

const caseSide = {
  verdict: "pass" as const,
  minScore: 80,
  scores: { faithfulness: 85, ndcg5: 81 },
  answer: "ans",
  traceId: "a".repeat(32),
};

describe("EvalCompareResponseSchema", () => {
  it("accepts a happy-path compare response", () => {
    const parsed = EvalCompareResponseSchema.safeParse({
      a: runSummary,
      b: { ...runSummary, overallScore: 85 },
      metrics: [
        { key: "faithfulness", a: 80, b: 85, delta: 5, significant: true },
        { key: "ndcg5", a: 81, b: 81, delta: 0, significant: false },
      ],
      latency: { aP95Ms: 1200, bP95Ms: 1100 },
      tokens: { aAvgPerCase: 600, bAvgPerCase: 620 },
      cases: [
        { caseId: uuid, seq: 1, question: "q", a: caseSide, b: caseSide, regressed: false, improved: true },
      ],
      summary: {
        overallDelta: 3,
        improvedCount: 1,
        regressedCount: 0,
        flatCount: 0,
        excludedCount: 0,
        judgeMismatch: false,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an out-of-enum metric key", () => {
    expect(CompareMetricKeySchema.safeParse("madeUp").success).toBe(false);
    expect(CompareMetricKeySchema.safeParse("citation").success).toBe(true);
  });
});

describe("EvalCompareIncomparableSchema", () => {
  it("matches the 409 incomparable body", () => {
    expect(EvalCompareIncomparableSchema.parse({ code: "incomparable" }).code).toBe("incomparable");
  });
});
