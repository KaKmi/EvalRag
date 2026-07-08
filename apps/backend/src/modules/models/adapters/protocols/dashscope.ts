import { bearerHeaders, isObj, joinUrl, modelId, type ProbeBuilder } from "./types";

// 阿里云 DashScope 重排：/services/rerank/text-rerank/text-rerank

export const dashscopeRerankProbe: ProbeBuilder = (c) => ({
  url: joinUrl(c.baseUrl, "/services/rerank/text-rerank/text-rerank"),
  headers: bearerHeaders(c.apiKey),
  body: {
    model: modelId(c),
    input: { query: "ping", documents: ["ping", "pong"] },
    parameters: { top_n: 1 },
  },
  shapeOk: (json) =>
    isObj(json) && isObj(json.output) && Array.isArray((json.output as Record<string, unknown>).results),
});
