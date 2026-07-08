import { isObj, joinUrl, modelId, type ProbeBuilder } from "./types";

// Anthropic Messages API：认证用 x-api-key + anthropic-version（非 Bearer）

export const anthropicChatProbe: ProbeBuilder = (c) => ({
  url: joinUrl(c.baseUrl, "/v1/messages"),
  headers: {
    "x-api-key": c.apiKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  },
  body: {
    model: modelId(c),
    max_tokens: 1,
    messages: [{ role: "user", content: "ping" }],
  },
  shapeOk: (json) => isObj(json) && Array.isArray(json.content),
});
