import { bearerHeaders, joinUrl, type ProbeBuilder } from "./types";

// 自部署 (HTTP)：TEI（text-embeddings-inference）兼容形状——bge-m3 / bge-reranker 自建服务的主流跑法。
// OpenAI 形自建服务（如 vLLM）应选 openai_compat 协议。
// TEI 响应：/embed → [[...浮点]]；/rerank → [{index, score}]（均为顶层数组）。

export const selfHostedEmbeddingProbe: ProbeBuilder = (c) => ({
  url: joinUrl(c.baseUrl, "/embed"),
  headers: bearerHeaders(c.apiKey),
  body: { inputs: ["ping"] },
  shapeOk: (json) => Array.isArray(json),
});

export const selfHostedRerankProbe: ProbeBuilder = (c) => ({
  url: joinUrl(c.baseUrl, "/rerank"),
  headers: bearerHeaders(c.apiKey),
  body: { query: "ping", texts: ["ping", "pong"] },
  shapeOk: (json) => Array.isArray(json),
});
