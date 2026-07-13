import type { ModelProtocol } from "@codecrush/contracts";
import { bearerHeaders, isObj, joinUrl, modelId } from "./protocols/types";
import {
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  systemContent,
  userContent,
  mergedTemperature,
  storedMaxTokens,
} from "./chat-builders";
import { pickGeminiUsage, pickOpenaiUsage } from "./usage";
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  ModelCallConfig,
} from "../ports/model-provider.port";

export interface ChatStreamRequestSpec {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** openai_compat/gemini：逐个已拆分的 JSON 分片字符串（或 "[DONE]"）→ chunk */
  parseChunk: (raw: string) => ChatStreamChunk;
  /** anthropic：SSE event 类型 + data 载荷字符串 → chunk（openai_compat/gemini 不用） */
  parseEvent: (event: string, data: string) => ChatStreamChunk;
}

export type ChatStreamBuilder = (
  config: ModelCallConfig,
  messages: ChatMessage[],
  opts: ChatOptions,
) => ChatStreamRequestSpec;

const noopParseEvent = (): ChatStreamChunk => ({});
const noopParseChunk = (): ChatStreamChunk => ({});

export const CHAT_STREAM_BUILDERS: Partial<Record<ModelProtocol, ChatStreamBuilder>> = {
  openai_compat: (c, messages, opts) => {
    const temperature = mergedTemperature(c, opts);
    const maxTokens = storedMaxTokens(c);
    return {
      url: joinUrl(c.baseUrl, "/chat/completions"),
      headers: bearerHeaders(c.apiKey),
      body: {
        model: modelId(c),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        // M8 T3：要末帧的 token 用量（choices 空 + 顶层 usage）
        stream_options: { include_usage: true },
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      },
      parseChunk: (raw) => {
        if (raw.trim() === "[DONE]") return { done: true };
        const json: unknown = JSON.parse(raw);
        if (!isObj(json)) return {};
        const out: ChatStreamChunk = {};
        // usage 末帧 choices 通常为空；delta 与 usage 也可能不同帧到达，分别处理
        const usage = pickOpenaiUsage(json);
        if (usage) out.usage = usage;
        if (Array.isArray(json.choices)) {
          const delta = (json.choices[0] as { delta?: { content?: unknown } })?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) out.delta = delta;
        }
        return out;
      },
      parseEvent: noopParseEvent,
    };
  },
  anthropic: (c, messages, opts) => {
    const temperature = mergedTemperature(c, opts);
    return {
      url: joinUrl(c.baseUrl, "/v1/messages"),
      headers: {
        "x-api-key": c.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: {
        model: modelId(c),
        max_tokens: storedMaxTokens(c) ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
        system: systemContent(messages),
        messages: [{ role: "user", content: userContent(messages) }],
        stream: true,
        ...(temperature !== undefined ? { temperature } : {}),
      },
      parseChunk: noopParseChunk,
      parseEvent: (event, data) => {
        if (event === "message_stop") return { done: true };
        // M8 T3：anthropic 把 token 用量拆两帧——message_start 带 input、message_delta 带 output（累计）
        if (event === "message_start") {
          const json: unknown = JSON.parse(data);
          const u =
            isObj(json) && isObj(json.message)
              ? (json.message as { usage?: { input_tokens?: unknown } }).usage
              : undefined;
          return u && typeof u.input_tokens === "number"
            ? { usage: { inputTokens: u.input_tokens, outputTokens: 0 } }
            : {};
        }
        if (event === "message_delta") {
          const json: unknown = JSON.parse(data);
          const u = isObj(json)
            ? (json as { usage?: { output_tokens?: unknown } }).usage
            : undefined;
          return u && typeof u.output_tokens === "number"
            ? { usage: { inputTokens: 0, outputTokens: u.output_tokens } }
            : {};
        }
        if (event !== "content_block_delta") return {};
        const json: unknown = JSON.parse(data);
        if (!isObj(json)) return {};
        const d = json.delta as { type?: unknown; text?: unknown } | undefined;
        return d?.type === "text_delta" && typeof d.text === "string" ? { delta: d.text } : {};
      },
    };
  },
  gemini: (c, messages, opts) => {
    const temperature = mergedTemperature(c, opts);
    const maxTokens = storedMaxTokens(c);
    const generationConfig = {
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { maxOutputTokens: maxTokens } : {}),
    };
    return {
      url: joinUrl(c.baseUrl, `/models/${modelId(c)}:streamGenerateContent?alt=sse`),
      headers: { "x-goog-api-key": c.apiKey, "Content-Type": "application/json" },
      body: {
        system_instruction: { parts: [{ text: systemContent(messages) }] },
        contents: [{ role: "user", parts: [{ text: userContent(messages) }] }],
        ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
      },
      parseChunk: (raw) => {
        const json: unknown = JSON.parse(raw);
        if (!isObj(json)) return {};
        const out: ChatStreamChunk = {};
        // M8 T3：gemini 每帧可能带 usageMetadata，末帧为最终累计
        const usage = pickGeminiUsage(json);
        if (usage) out.usage = usage;
        if (Array.isArray(json.candidates)) {
          const parts = (json.candidates[0] as { content?: { parts?: Array<{ text?: unknown }> } })
            ?.content?.parts;
          if (Array.isArray(parts)) {
            const text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
            if (text.length > 0) out.delta = text;
          }
        }
        return out;
      },
      parseEvent: noopParseEvent,
    };
  },
};
