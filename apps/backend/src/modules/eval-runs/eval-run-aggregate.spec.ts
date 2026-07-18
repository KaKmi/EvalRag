import { aggregateCaseRows, aggregateResults } from "./eval-run-aggregate";
import type { EvalRunResultWithCase } from "./eval-runs.repository";

const row = (over: Partial<EvalRunResultWithCase>): EvalRunResultWithCase =>
  ({
    id: "r",
    runId: "run1",
    caseVersionId: "cv-1",
    seq: 1,
    repeatIndex: 1,
    verdict: "pass",
    faithfulness: null,
    answerRelevancy: null,
    contextPrecision: null,
    correctness: null,
    citation: null,
    contextRecall: null,
    ndcg5: null,
    hitRate5: null,
    minMetric: null,
    minScore: null,
    evidence: {},
    previewTraceId: null,
    answer: "",
    tokensUsed: 0,
    durationMs: 0,
    error: null,
    createdAt: new Date(),
    caseId: "case-1",
    caseVersion: 1,
    question: "q",
    ...over,
  }) as EvalRunResultWithCase;

describe("aggregateCaseRows（F5：多次重复取非空均值）", () => {
  it("3 次 {80,90,null} → faithfulness 85（非空均值），repeats 长度 3", () => {
    const agg = aggregateCaseRows([
      row({ repeatIndex: 1, faithfulness: 80, verdict: "pass" }),
      row({ repeatIndex: 2, faithfulness: 90, verdict: "pass" }),
      row({ repeatIndex: 3, faithfulness: null, verdict: "unscored" }),
    ]);
    expect(agg.faithfulness).toBe(85);
    expect(agg.repeats).toHaveLength(3);
    expect(agg.repeatCount).toBe(3);
  });

  it("全部重复 timeout → 聚合 verdict = timeout", () => {
    const agg = aggregateCaseRows([
      row({ repeatIndex: 1, verdict: "timeout" }),
      row({ repeatIndex: 2, verdict: "timeout" }),
    ]);
    expect(agg.verdict).toBe("timeout");
  });

  it("两次 timeout 一次 pass → 按非空均值 decideVerdict", () => {
    const agg = aggregateCaseRows([
      row({ repeatIndex: 1, verdict: "timeout" }),
      row({
        repeatIndex: 2,
        verdict: "pass",
        faithfulness: 90,
        answerRelevancy: 90,
        contextPrecision: 90,
      }),
      row({ repeatIndex: 3, verdict: "timeout" }),
    ]);
    expect(agg.verdict).toBe("pass");
    expect(agg.faithfulness).toBe(90);
  });

  it("repeatCount=1 → 顶层 == 单次明细（W2a 退化恒等）", () => {
    const agg = aggregateCaseRows([
      row({ faithfulness: 77, answerRelevancy: 80, contextPrecision: 85, verdict: "weak" }),
    ]);
    expect(agg.repeats).toHaveLength(1);
    expect(agg.faithfulness).toBe(77);
    expect(agg.verdict).toBe("weak");
  });

  it("顶层 answer/previewTraceId/evidence 取 repeatIndex 最小的行", () => {
    const agg = aggregateCaseRows([
      row({ repeatIndex: 2, answer: "第二次", previewTraceId: "t2" }),
      row({ repeatIndex: 1, answer: "第一次", previewTraceId: "t1" }),
    ]);
    expect(agg.answer).toBe("第一次");
    expect(agg.previewTraceId).toBe("t1");
  });

  it("citation/检索三项也取均值（但不进 verdict）", () => {
    const agg = aggregateCaseRows([
      row({ repeatIndex: 1, citation: 60, contextRecall: 100, verdict: "pass", faithfulness: 90 }),
      row({ repeatIndex: 2, citation: 80, contextRecall: 50, verdict: "pass", faithfulness: 90 }),
    ]);
    expect(agg.citation).toBe(70);
    expect(agg.contextRecall).toBe(75);
    // citation 不影响 verdict/minMetric（只有 faithfulness 参与）。
    expect(agg.minMetric).toBe("faithfulness");
  });
});

describe("aggregateResults（分组 + 排序）", () => {
  it("按 caseVersionId 分组，minScore 升序 NULLS LAST", () => {
    // minScore 由 decideVerdict 从聚合分算出（非行内 minScore 字段）——用 faithfulness 驱动。
    const out = aggregateResults([
      row({ caseVersionId: "cv-1", seq: 1, faithfulness: 90, verdict: "pass" }),
      row({ caseVersionId: "cv-2", seq: 2, faithfulness: 40, verdict: "low" }),
      row({ caseVersionId: "cv-3", seq: 3, faithfulness: null, verdict: "unscored" }),
    ]);
    expect(out.map((r) => r.seq)).toEqual([2, 1, 3]);
  });
});
