import { bearerHeaders, isObj, joinUrl, modelId, type ProbeBuilder } from "./types";

// Cohere：/embed 与 /rerank

export const cohereEmbeddingProbe: ProbeBuilder = (c) => ({
  url: joinUrl(c.baseUrl, "/embed"),
  headers: bearerHeaders(c.apiKey),
  body: { model: modelId(c), texts: ["ping"], input_type: "search_query" },
  shapeOk: (json) => isObj(json) && (Array.isArray(json.embeddings) || isObj(json.embeddings)),
});

export const cohereRerankProbe: ProbeBuilder = (c) => ({
  url: joinUrl(c.baseUrl, "/rerank"),
  headers: bearerHeaders(c.apiKey),
  body: { model: modelId(c), query: "ping", documents: ["ping", "pong"], top_n: 1 },
  shapeOk: (json) => isObj(json) && Array.isArray(json.results),
});
