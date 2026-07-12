import type { RetrievalHit, RetrievalTestRequest, ApplicationRetrievalParams } from "@codecrush/contracts";

/** 应用检索参数 → 每 KB 一条 RetrievalTestRequest（threshold 恒 0，交给编排层按 FALLBACK_THRESHOLD 判定兜底）。 */
export function buildRetrievalRequests(a: {
  query: string;
  routeKbIds: string[];
  embedModelId: string;
  retrieval: ApplicationRetrievalParams;
}): RetrievalTestRequest[] {
  const r = a.retrieval;
  return a.routeKbIds.map((kbId) => ({
    query: a.query,
    kbId,
    embedModelId: a.embedModelId,
    topK: r.topK,
    topN: r.topN,
    threshold: 0,
    multi: r.hybridEnabled,
    vecWeight: r.vectorWeight,
    rerankModelId: r.rerankEnabled ? r.rerankModelId : undefined,
    rerankThreshold: r.rerankEnabled ? r.rerankThreshold : undefined,
  }));
}

/** 携带 KB 归属的检索命中（citation.kb 的数据通路，Drill 修订 F1）。 */
export type TaggedHit = RetrievalHit & { kbId: string };

/** 多 KB 命中合并：打 kbId 标签 → 按 chunkId 去重保留更高 finalScore → 全局按 finalScore 降序。 */
export function mergeHits(perKb: Array<{ kbId: string; hits: RetrievalHit[] }>): TaggedHit[] {
  const byChunk = new Map<string, TaggedHit>();
  for (const g of perKb) {
    for (const h of g.hits) {
      const tagged: TaggedHit = { ...h, kbId: g.kbId };
      const existing = byChunk.get(h.chunkId);
      if (!existing || tagged.finalScore > existing.finalScore) {
        byChunk.set(h.chunkId, tagged);
      }
    }
  }
  return [...byChunk.values()].sort((x, y) => y.finalScore - x.finalScore);
}
