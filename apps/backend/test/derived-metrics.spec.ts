import {
  decideFallback,
  deriveConfidence,
  deriveCoverage,
  resolveRetrievalKbIds,
} from "../src/modules/chat/derived-metrics";
import { FALLBACK_THRESHOLD } from "../src/modules/chat/orchestration.constants";

describe("deriveConfidence", () => {
  it("confidence = 分数数组的最大值", () => {
    expect(deriveConfidence([0.9])).toBeCloseTo(0.9);
    expect(deriveConfidence([0.3, 0.7, 0.5])).toBeCloseTo(0.7);
  });
  it("空数组 → undefined", () => {
    expect(deriveConfidence([])).toBeUndefined();
  });
});

describe("deriveCoverage", () => {
  it("full：非兜底且文中 [n] 全合法且 ≥1 条引用", () => {
    expect(deriveCoverage("答案[1][2]", 2, false)).toBe("full");
  });
  it("partial：无角标 / 有越界角标 / 兜底", () => {
    expect(deriveCoverage("无引用回答", 2, false)).toBe("partial");
    expect(deriveCoverage("越界[3]", 2, false)).toBe("partial");
    expect(deriveCoverage("兜底话术", 0, true)).toBe("partial");
  });
});

describe("decideFallback", () => {
  it("空召回 → empty_retrieval + handled_by_fallback，isFallback=true", () => {
    const d = decideFallback({
      topScore: undefined,
      hitCount: 0,
      threshold: FALLBACK_THRESHOLD,
      scopeKbNames: ["售后库"],
    });
    expect(d.isFallback).toBe(true);
    expect(d.reasons).toContain("empty_retrieval");
    expect(d.reasons).toContain("handled_by_fallback");
  });
  it("低分（topScore 0.1 < 阈值 0.2）→ low_similarity", () => {
    const d = decideFallback({
      topScore: 0.1,
      hitCount: 3,
      threshold: 0.2,
      scopeKbNames: ["k"],
    });
    expect(d.isFallback).toBe(true);
    expect(d.reasons).toContain("low_similarity");
    expect(d.reasons).toContain("handled_by_fallback");
  });
  it("正常（0.8 ≥ 0.2）→ isFallback=false，reasons 为空", () => {
    const d = decideFallback({
      topScore: 0.8,
      hitCount: 3,
      threshold: 0.2,
      scopeKbNames: ["k"],
    });
    expect(d.isFallback).toBe(false);
    expect(d.reasons).toEqual([]);
  });
});

describe("resolveRetrievalKbIds", () => {
  const cfg = { kbIds: ["kb_a", "kb_b", "kb_c"] };
  const kbRows = [
    { id: "kb_a", intentKey: "SUPPORT" },
    { id: "kb_b", intentKey: null },
    { id: "kb_c", intentKey: "SALES" },
  ];

  it("CHAT → 空数组（不检索）", () => {
    expect(resolveRetrievalKbIds("CHAT", cfg, kbRows)).toEqual([]);
  });
  it("UNKNOWN → cfg.kbIds 全量召回", () => {
    expect(resolveRetrievalKbIds("UNKNOWN", cfg, kbRows)).toEqual(cfg.kbIds);
  });
  it("业务 key 命中 → 绑定该 key 的 KB + 未绑定通配 KB，排除绑其他 key 的 KB", () => {
    expect(resolveRetrievalKbIds("SUPPORT", cfg, kbRows)).toEqual([
      "kb_a",
      "kb_b",
    ]);
  });
  it("全部 KB 绑定到其他 key → 结果为空 → 回退 cfg.kbIds", () => {
    const allBoundOther = [
      { id: "kb_a", intentKey: "SALES" },
      { id: "kb_b", intentKey: "SALES" },
    ];
    expect(resolveRetrievalKbIds("SUPPORT", cfg, allBoundOther)).toEqual(
      cfg.kbIds,
    );
  });
});
