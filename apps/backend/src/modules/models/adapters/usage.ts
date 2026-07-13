import { isObj } from "./protocols/types";

/**
 * M8 T3：LLM token 用量解析（gen_ai.usage.*）。三协议的 usage 载荷形状不同，
 * 且非流式与流式对 openai/gemini 是同一形状（openai 末帧的 usage 与非流 usage 一致、
 * gemini 每帧的 usageMetadata 与非流一致），故抽此共享层避免两份漂移。
 * anthropic 流式把 input/output 拆到 message_start / message_delta 两帧，
 * 不套此非流解析，由 chat-stream-builders 就地处理。
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** openai_compat：`usage.prompt_tokens` / `usage.completion_tokens`（非流响应体 & 流末帧同形）。 */
export function pickOpenaiUsage(json: unknown): TokenUsage | undefined {
  if (!isObj(json) || !isObj(json.usage)) return undefined;
  const u = json.usage as { prompt_tokens?: unknown; completion_tokens?: unknown };
  const i = num(u.prompt_tokens);
  const o = num(u.completion_tokens);
  return i !== undefined && o !== undefined ? { inputTokens: i, outputTokens: o } : undefined;
}

/** anthropic 非流：`usage.input_tokens` / `usage.output_tokens`。 */
export function pickAnthropicUsage(json: unknown): TokenUsage | undefined {
  if (!isObj(json) || !isObj(json.usage)) return undefined;
  const u = json.usage as { input_tokens?: unknown; output_tokens?: unknown };
  const i = num(u.input_tokens);
  const o = num(u.output_tokens);
  return i !== undefined && o !== undefined ? { inputTokens: i, outputTokens: o } : undefined;
}

/** gemini：`usageMetadata.promptTokenCount` / `usageMetadata.candidatesTokenCount`（非流 & 流式每帧同形）。 */
export function pickGeminiUsage(json: unknown): TokenUsage | undefined {
  if (!isObj(json) || !isObj(json.usageMetadata)) return undefined;
  const u = json.usageMetadata as { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
  const i = num(u.promptTokenCount);
  const o = num(u.candidatesTokenCount);
  return i !== undefined && o !== undefined ? { inputTokens: i, outputTokens: o } : undefined;
}
