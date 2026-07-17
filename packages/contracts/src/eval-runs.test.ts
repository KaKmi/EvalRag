import { describe, expect, it } from "vitest";
import { CreateEvalRunRequestSchema, EvalRunStatusSchema, EvalRunResultSchema } from "./eval-runs";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("CreateEvalRunRequestSchema", () => {
  it("defaults force to false", () => {
    const parsed = CreateEvalRunRequestSchema.parse({
      setId: uuid,
      applicationId: uuid,
      configVersionId: uuid,
      judgeModelId: uuid,
      embeddingModelId: uuid,
    });
    expect(parsed.force).toBe(false);
  });
  it("has no repeatCount in W2a scope", () => {
    const parsed = CreateEvalRunRequestSchema.parse({
      setId: uuid,
      applicationId: uuid,
      configVersionId: uuid,
      judgeModelId: uuid,
      embeddingModelId: uuid,
      repeatCount: 3,
    } as Record<string, unknown>);
    expect("repeatCount" in parsed).toBe(false);
  });
});

describe("EvalRunStatusSchema", () => {
  it("matches the prototype state machine exactly", () => {
    expect(EvalRunStatusSchema.options).toEqual([
      "queued",
      "running",
      "done",
      "partial",
      "budget_stop",
      "failed",
    ]);
  });
});

describe("EvalRunResultSchema", () => {
  it("allows null scores (未评 must never be 0)", () => {
    const parsed = EvalRunResultSchema.parse({
      seq: 1,
      caseId: uuid,
      caseVersion: 1,
      question: "q",
      faithfulness: null,
      answerRelevancy: null,
      contextPrecision: null,
      correctness: null,
      minMetric: null,
      minScore: null,
      verdict: "unscored",
      evidence: {},
      previewTraceId: null,
      answer: "",
      durationMs: 0,
      error: "judge failed",
    });
    expect(parsed.faithfulness).toBeNull();
  });

  it("accepts partial evidence (只有评出来的指标才有 evidence)", () => {
    const parsed = EvalRunResultSchema.parse({
      seq: 1,
      caseId: uuid,
      caseVersion: 1,
      question: "q",
      faithfulness: 91,
      answerRelevancy: null,
      contextPrecision: 78,
      correctness: null,
      minMetric: "contextPrecision",
      minScore: 78,
      verdict: "weak",
      evidence: { faithfulness: ["ok"], contextPrecision: ["ok"] },
      previewTraceId: "a".repeat(32),
      answer: "ans",
      durationMs: 120,
      error: null,
    });
    expect(parsed.evidence.answerRelevancy).toBeUndefined();
    expect(parsed.evidence.faithfulness).toEqual(["ok"]);
  });
});
