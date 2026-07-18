import { computeGoldMetrics, type RankedHitRef } from "./retrieval-gold-metrics";
import type { GoldDocRefRow } from "./schema";

const ref = (docId: string, chunkId: string | null = null): GoldDocRefRow => ({
  docId,
  chunkId,
  docName: "",
  section: null,
});
const hit = (chunkId: string, docId: string): RankedHitRef => ({ chunkId, docId });

describe("computeGoldMetrics", () => {
  it("gold 空 → null（未标 gold docs，绝不退化成 0）", () => {
    expect(computeGoldMetrics([hit("c1", "d1")], [])).toBeNull();
  });

  it("chunk 级全命中", () => {
    expect(
      computeGoldMetrics(
        [hit("c1", "d1"), hit("c2", "d1")],
        [ref("d1", "c1"), ref("d1", "c2")],
      ),
    ).toEqual({ contextRecall: 100, ndcg5: 100, hitRate5: 100 });
  });

  it("doc 级回退匹配（ref.chunkId=null 按 docId 匹配）", () => {
    expect(computeGoldMetrics([hit("c9", "d1")], [ref("d1")])).toEqual({
      contextRecall: 100,
      ndcg5: 100,
      hitRate5: 100,
    });
  });

  it("零命中 → 全 0", () => {
    expect(computeGoldMetrics([hit("c1", "d1")], [ref("d2", "c9")])).toEqual({
      contextRecall: 0,
      ndcg5: 0,
      hitRate5: 0,
    });
  });

  it("chunk 级与 doc 级混合 ref", () => {
    const m = computeGoldMetrics(
      [hit("c1", "d1"), hit("cX", "d2")],
      [ref("d1", "c1"), ref("d2")], // 一个 chunk 级、一个 doc 级
    );
    expect(m).toEqual({ contextRecall: 100, ndcg5: 100, hitRate5: 100 });
  });

  it("NDCG 位次敏感（相关排 1,2 位 > 排 4,5 位）", () => {
    const refs = [ref("dx", "g1"), ref("dx", "g2")];
    const front = computeGoldMetrics(
      [hit("g1", "dx"), hit("g2", "dx"), hit("a", "d1"), hit("b", "d2"), hit("c", "d3")],
      refs,
    )!;
    const back = computeGoldMetrics(
      [hit("a", "d1"), hit("b", "d2"), hit("c", "d3"), hit("g1", "dx"), hit("g2", "dx")],
      refs,
    )!;
    expect(front.ndcg5).toBeGreaterThan(back.ndcg5);
    expect(front.contextRecall).toBe(100);
    expect(back.contextRecall).toBe(100);
  });

  it("同一 ref 不重复计相关（1 个 doc 级 gold、top5 全同 doc 命中 → DCG=IDCG）", () => {
    const m = computeGoldMetrics(
      ["c1", "c2", "c3", "c4", "c5"].map((c) => hit(c, "d1")),
      [ref("d1")],
    )!;
    expect(m.ndcg5).toBe(100);
    expect(m.hitRate5).toBe(100);
  });

  it("同 doc 多 chunk gold（两个 chunk 级 ref 同 doc）", () => {
    const m = computeGoldMetrics(
      [hit("c1", "d1"), hit("c2", "d1")],
      [ref("d1", "c1"), ref("d1", "c2")],
    )!;
    expect(m.contextRecall).toBe(100);
  });

  it("recall 扫描全列表（gold 在第 8 位命中：recall=100，top5 未中 → ndcg/hit=0）", () => {
    const hits = ["a", "b", "c", "d", "e", "f", "g"].map((c) => hit(c, "dz"));
    hits.push(hit("g1", "d1"));
    expect(computeGoldMetrics(hits, [ref("d1", "g1")])).toEqual({
      contextRecall: 100,
      ndcg5: 0,
      hitRate5: 0,
    });
  });

  it("部分命中（2 gold 中 1 个 top5 命中）", () => {
    const m = computeGoldMetrics(
      [hit("g1", "dx"), hit("a", "d1")],
      [ref("dx", "g1"), ref("dy", "g2")],
    )!;
    expect(m.contextRecall).toBe(50);
    expect(m.hitRate5).toBe(100); // top5 内存在任一命中
  });
});
