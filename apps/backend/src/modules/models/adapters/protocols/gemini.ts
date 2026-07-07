import { isObj, joinUrl, modelId, type ProbeBuilder } from "./types";

// Google Gemini：LLM generateContent / Embedding embedContent 同一 API family。
// 认证用 x-goog-api-key 请求头，不用 ?key= 查询参数——key 进 URL 会泄漏到日志/代理。

function geminiHeaders(apiKey: string): Record<string, string> {
  return { "x-goog-api-key": apiKey, "Content-Type": "application/json" };
}

export const geminiChatProbe: ProbeBuilder = (c) => ({
  url: joinUrl(c.baseUrl, `/models/${modelId(c)}:generateContent`),
  headers: geminiHeaders(c.apiKey),
  body: { contents: [{ parts: [{ text: "ping" }] }] },
  shapeOk: (json) => isObj(json) && Array.isArray(json.candidates),
});

export const geminiEmbeddingProbe: ProbeBuilder = (c) => ({
  url: joinUrl(c.baseUrl, `/models/${modelId(c)}:embedContent`),
  headers: geminiHeaders(c.apiKey),
  body: { content: { parts: [{ text: "ping" }] } },
  shapeOk: (json) =>
    isObj(json) && isObj(json.embedding) && Array.isArray((json.embedding as Record<string, unknown>).values),
});
