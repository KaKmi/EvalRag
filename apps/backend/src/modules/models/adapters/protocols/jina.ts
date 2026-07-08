import { bearerHeaders, isObj, joinUrl, modelId, type ProbeBuilder } from "./types";

// Jina：/embeddings（OpenAI 形）与 /rerank

export const jinaEmbeddingProbe: ProbeBuilder = (c) => ({
  url: joinUrl(c.baseUrl, "/embeddings"),
  headers: bearerHeaders(c.apiKey),
  body: { model: modelId(c), input: ["ping"] },
  shapeOk: (json) => isObj(json) && Array.isArray(json.data),
});

export const jinaRerankProbe: ProbeBuilder = (c) => ({
  url: joinUrl(c.baseUrl, "/rerank"),
  headers: bearerHeaders(c.apiKey),
  body: { model: modelId(c), query: "ping", documents: ["ping", "pong"], top_n: 1 },
  shapeOk: (json) => isObj(json) && Array.isArray(json.results),
});
