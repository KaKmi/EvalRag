import { CHAT_STREAM_BUILDERS } from "../src/modules/models/adapters/chat-stream-builders";
import type { ChatMessage, ModelCallConfig } from "../src/modules/models/ports/model-provider.port";

// M8.0 Story 2：chatStream 三协议 builder——纯函数，只负责 body 构造 + 分片解析
// （fetch/超时/SSE 帧切割留给 Story 3 的 dispatch adapter）。

const config: ModelCallConfig = {
  type: "llm",
  protocol: "openai_compat",
  name: "m",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-topsecret",
};
const messages: ChatMessage[] = [
  { role: "system", content: "s" },
  { role: "user", content: "u" },
];

describe("CHAT_STREAM_BUILDERS · openai_compat", () => {
  it("body 带 stream:true，parseChunk 抽取 delta.content", () => {
    const req = CHAT_STREAM_BUILDERS.openai_compat!(config, messages, {});
    expect((req.body as { stream: boolean }).stream).toBe(true);
    const chunk = req.parseChunk('{"choices":[{"delta":{"content":"你"}}]}');
    expect(chunk).toEqual({ delta: "你" });
  });

  it("parseChunk：[DONE] 标记 → done:true", () => {
    const req = CHAT_STREAM_BUILDERS.openai_compat!(config, messages, {});
    expect(req.parseChunk("[DONE]")).toEqual({ done: true });
  });

  it("parseChunk：无 delta.content 的心跳/角色声明分片 → 空对象（无 delta 也不 done）", () => {
    const req = CHAT_STREAM_BUILDERS.openai_compat!(config, messages, {});
    expect(req.parseChunk('{"choices":[{"delta":{"role":"assistant"}}]}')).toEqual({});
  });

  it("url/headers 与非流式 builder 一致", () => {
    const req = CHAT_STREAM_BUILDERS.openai_compat!(config, messages, {});
    expect(req.url).toBe("https://api.example.com/v1/chat/completions");
    expect(req.headers.Authorization).toBe("Bearer sk-topsecret");
  });
});

describe("CHAT_STREAM_BUILDERS · anthropic", () => {
  const c = { ...config, protocol: "anthropic" as const };

  it("body 带 stream:true", () => {
    const req = CHAT_STREAM_BUILDERS.anthropic!(c, messages, {});
    expect((req.body as { stream: boolean }).stream).toBe(true);
  });

  it("parseEvent：content_block_delta + text_delta → delta", () => {
    const req = CHAT_STREAM_BUILDERS.anthropic!(c, messages, {});
    const chunk = req.parseEvent(
      "content_block_delta",
      '{"delta":{"type":"text_delta","text":"你"}}',
    );
    expect(chunk).toEqual({ delta: "你" });
  });

  it("parseEvent：message_stop → done:true", () => {
    const req = CHAT_STREAM_BUILDERS.anthropic!(c, messages, {});
    expect(req.parseEvent("message_stop", "{}")).toEqual({ done: true });
  });

  it("parseEvent：非 delta/stop 事件（如 content_block_start）→ 空对象", () => {
    const req = CHAT_STREAM_BUILDERS.anthropic!(c, messages, {});
    expect(req.parseEvent("content_block_start", "{}")).toEqual({});
  });

  it("parseChunk 对 anthropic 是 noop（不使用，anthropic 走 parseEvent）", () => {
    const req = CHAT_STREAM_BUILDERS.anthropic!(c, messages, {});
    expect(req.parseChunk("anything")).toEqual({});
  });
});

describe("CHAT_STREAM_BUILDERS · gemini", () => {
  const c = { ...config, protocol: "gemini" as const };

  it("url 使用 :streamGenerateContent 端点", () => {
    const req = CHAT_STREAM_BUILDERS.gemini!(c, messages, {});
    expect(req.url).toContain(":streamGenerateContent");
  });

  it("parseChunk：抽取 candidates[0].content.parts[].text 拼接", () => {
    const req = CHAT_STREAM_BUILDERS.gemini!(c, messages, {});
    const chunk = req.parseChunk(
      '{"candidates":[{"content":{"parts":[{"text":"你"}]}}]}',
    );
    expect(chunk).toEqual({ delta: "你" });
  });

  it("parseChunk：空 parts → 空对象", () => {
    const req = CHAT_STREAM_BUILDERS.gemini!(c, messages, {});
    expect(req.parseChunk('{"candidates":[{"content":{"parts":[]}}]}')).toEqual({});
  });

  it("parseEvent 对 gemini 是 noop（不使用，gemini 走 parseChunk）", () => {
    const req = CHAT_STREAM_BUILDERS.gemini!(c, messages, {});
    expect(req.parseEvent("anything", "{}")).toEqual({});
  });
});

// M8 T3：三协议流式 token 用量解析
describe("CHAT_STREAM_BUILDERS · usage", () => {
  it("openai：body 含 stream_options.include_usage；末帧 choices 空 + usage → { usage }", () => {
    const req = CHAT_STREAM_BUILDERS.openai_compat!(config, messages, {});
    expect(req.body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(
      req.parseChunk(JSON.stringify({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 4 } })),
    ).toEqual({ usage: { inputTokens: 9, outputTokens: 4 } });
  });

  it("anthropic：message_start → input，message_delta → output", () => {
    const c = { ...config, protocol: "anthropic" as const };
    const req = CHAT_STREAM_BUILDERS.anthropic!(c, messages, {});
    expect(
      req.parseEvent("message_start", JSON.stringify({ message: { usage: { input_tokens: 8 } } })),
    ).toEqual({ usage: { inputTokens: 8, outputTokens: 0 } });
    expect(req.parseEvent("message_delta", JSON.stringify({ usage: { output_tokens: 3 } }))).toEqual({
      usage: { inputTokens: 0, outputTokens: 3 },
    });
  });

  it("gemini：usageMetadata 可与 delta 同帧返回", () => {
    const c = { ...config, protocol: "gemini" as const };
    const req = CHAT_STREAM_BUILDERS.gemini!(c, messages, {});
    expect(
      req.parseChunk(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "hi" }] } }],
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 7 },
        }),
      ),
    ).toEqual({ delta: "hi", usage: { inputTokens: 20, outputTokens: 7 } });
  });
});
