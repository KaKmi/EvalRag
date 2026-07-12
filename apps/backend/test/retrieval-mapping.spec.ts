import { buildRetrievalRequests, mergeHits } from "../src/modules/chat/retrieval-mapping";
import type { ApplicationRetrievalParams, RetrievalHit } from "@codecrush/contracts";

function hit(chunkId: string, finalScore: number): RetrievalHit {
  return {
    chunkId,
    docId: `doc_${chunkId}`,
    docName: `doc ${chunkId}`,
    text: `text ${chunkId}`,
    section: `section ${chunkId}`,
    vecScore: finalScore,
    finalScore,
  };
}

describe("buildRetrievalRequests", () => {
  it("映射：rerankEnabled=false 不传 rerankModelId，threshold 恒 0，multi=hybridEnabled", () => {
    const reqs = buildRetrievalRequests({
      query: "q",
      routeKbIds: ["kb_a"],
      embedModelId: "emb",
      retrieval: {
        schemaVersion: 1,
        topK: 10,
        topN: 5,
        hybridEnabled: true,
        vectorWeight: 0.7,
        rerankEnabled: false,
      } satisfies ApplicationRetrievalParams,
    });
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({
      query: "q",
      kbId: "kb_a",
      embedModelId: "emb",
      threshold: 0,
      multi: true,
      vecWeight: 0.7,
      topK: 10,
      topN: 5,
    });
    expect(reqs[0].rerankModelId).toBeUndefined();
    expect(reqs[0].rerankThreshold).toBeUndefined();
  });

  it("映射：rerankEnabled=true 传 rerankModelId/rerankThreshold，2 KB → 2 请求", () => {
    const reqs = buildRetrievalRequests({
      query: "q",
      routeKbIds: ["kb_a", "kb_b"],
      embedModelId: "emb",
      retrieval: {
        schemaVersion: 1,
        topK: 10,
        topN: 5,
        hybridEnabled: true,
        vectorWeight: 0.6,
        rerankEnabled: true,
        rerankModelId: "rr",
        rerankThreshold: 0.5,
      } satisfies ApplicationRetrievalParams,
    });
    expect(reqs).toHaveLength(2);
    expect(reqs[0]).toMatchObject({ kbId: "kb_a", rerankModelId: "rr", rerankThreshold: 0.5 });
    expect(reqs[1]).toMatchObject({ kbId: "kb_b", rerankModelId: "rr", rerankThreshold: 0.5 });
  });
});

describe("mergeHits", () => {
  it("by chunkId 去重 + 按 finalScore 全局降序 + 携带正确 kbId", () => {
    const merged = mergeHits([
      { kbId: "kb_a", hits: [hit("a", 0.5), hit("b", 0.9)] },
      { kbId: "kb_b", hits: [hit("a", 0.5), hit("c", 0.7)] },
    ]);
    expect(merged.map((h) => h.chunkId)).toEqual(["b", "c", "a"]);
    expect(merged[0].kbId).toBe("kb_a");
    expect(merged[1].kbId).toBe("kb_b");
    // 重复 chunk "a"：分数相同保留先到的第一组，kbId 归 kb_a
    expect(merged[2].kbId).toBe("kb_a");
  });

  it("重复 chunk 第二组分数更高时保留第二组的分数与 kbId", () => {
    const merged = mergeHits([
      { kbId: "kb_a", hits: [hit("a", 0.5)] },
      { kbId: "kb_b", hits: [hit("a", 0.8)] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].finalScore).toBe(0.8);
    expect(merged[0].kbId).toBe("kb_b");
  });
});
