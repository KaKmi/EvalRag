import { bearerHeaders, isObj, joinUrl, modelId, type ProbeBuilder } from "./types";

// OpenAI 兼容：DeepSeek / Qwen / vLLM 等均可用此协议，改 Base URL 即可

export const openaiCompatChatProbe: ProbeBuilder = (c) => ({
  url: joinUrl(c.baseUrl, "/chat/completions"),
  headers: bearerHeaders(c.apiKey),
  body: {
    model: modelId(c),
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
  },
  shapeOk: (json) => isObj(json) && Array.isArray(json.choices),
});

export const openaiCompatEmbeddingProbe: ProbeBuilder = (c) => ({
  url: joinUrl(c.baseUrl, "/embeddings"),
  headers: bearerHeaders(c.apiKey),
  body: { model: modelId(c), input: "ping" },
  shapeOk: (json) => {
    if (!isObj(json) || !Array.isArray(json.data)) return false;
    const first = json.data[0] as Record<string, unknown> | undefined;
    return Array.isArray(first?.embedding);
  },
});
