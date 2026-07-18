import type { GoldDocRefRow } from "./schema";

/**
 * E-W2b F2：检索层 gold-docs 指标（Context Recall / NDCG@5 / 命中率@5）。
 *
 * **纯函数、零 LLM**——排序真值比对是 run 引擎的域知识（不是判分），故落 eval-runs 而非
 * evaluations。分数只落 PG、不发 span、不退化成 0（无 gold → null，不是 0）。
 *
 * 匹配规则（F2）：ref 带 chunkId → 按 chunkId 精确匹配；ref.chunkId 为 null（文档级遗留/CSV）
 * → 按 docId 匹配。
 */
export interface RankedHitRef {
  chunkId: string;
  docId: string;
}

export interface GoldMetrics {
  contextRecall: number;
  ndcg5: number;
  hitRate5: number;
}

const matches = (ref: GoldDocRefRow, hit: RankedHitRef): boolean =>
  ref.chunkId !== null ? ref.chunkId === hit.chunkId : ref.docId === hit.docId;

/**
 * @param rankedHits 阈值判定前的合并命中，按 rank 序（`orchestration.prepare` 的 retrievedHits）。
 * @param refs 用例的 gold 引用。**空数组 → 返回 null**（未标 gold docs，三项显示「—」）。
 * @returns 三项 0-100 整数，或 null（gold 空）。
 */
export function computeGoldMetrics(
  rankedHits: RankedHitRef[],
  refs: GoldDocRefRow[],
): GoldMetrics | null {
  if (refs.length === 0) return null;

  // Context Recall：对每个 ref 独立判「是否被任意 hit 命中」（不消耗语义，扫描**全列表**）。
  const matchedRefs = refs.filter((ref) => rankedHits.some((hit) => matches(ref, hit))).length;
  const contextRecall = Math.round((matchedRefs / refs.length) * 100);

  // NDCG@5：遍历 top5，命中「尚未被更高位消耗」的 ref → rel=1 并标记 consumed（同一 ref 不重复计相关）。
  const consumed = refs.map(() => false);
  let dcg = 0;
  let anyHitTop5 = false;
  rankedHits.slice(0, 5).forEach((hit, pos) => {
    const i = refs.findIndex((ref, idx) => !consumed[idx] && matches(ref, hit));
    if (i === -1) return;
    consumed[i] = true;
    anyHitTop5 = true;
    dcg += 1 / Math.log2(pos + 2); // pos 从 0 起 → 位置 1 的折扣 1/log2(2)=1
  });
  // IDCG：min(gold 数, 5) 个理想相关位。
  let idcg = 0;
  for (let i = 0; i < Math.min(refs.length, 5); i++) idcg += 1 / Math.log2(i + 2);
  const ndcg5 = Math.round((dcg / idcg) * 100);

  return { contextRecall, ndcg5, hitRate5: anyHitTop5 ? 100 : 0 };
}
