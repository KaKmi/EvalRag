import { describe, expect, it } from "vitest";
import {
  CreateModelRequestSchema,
  ModelProviderSchema,
  TestModelRequestSchema,
  TestModelResponseSchema,
  UpdateModelRequestSchema,
} from "./index";

const validCreate = {
  type: "llm",
  provider: "DeepSeek",
  name: "deepseek-chat",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-test12345678",
};

describe("M3 model contracts", () => {
  it("CreateModelRequestSchema 接受合法体且 enabled 缺省 true", () => {
    const r = CreateModelRequestSchema.parse(validCreate);
    expect(r.enabled).toBe(true);
    expect(r.apiKey).toBe("sk-test12345678");
  });
  it("CreateModelRequestSchema 拒绝缺 apiKey / apiKey<8 / 缺 baseUrl", () => {
    const { apiKey: _k, ...noKey } = validCreate;
    void _k;
    expect(() => CreateModelRequestSchema.parse(noKey)).toThrow();
    expect(() => CreateModelRequestSchema.parse({ ...validCreate, apiKey: "short" })).toThrow();
    const { baseUrl: _b, ...noBase } = validCreate;
    void _b;
    expect(() => CreateModelRequestSchema.parse(noBase)).toThrow();
  });
  it("ModelProviderSchema 要求 apiKeyMasked、无 apiKey 字段", () => {
    const read = {
      id: "m1",
      type: "llm",
      provider: "DeepSeek",
      name: "deepseek-chat",
      baseUrl: "https://api.deepseek.com/v1",
      apiKeyMasked: "sk-****5678",
      enabled: true,
    };
    expect(ModelProviderSchema.parse(read)).toEqual(read);
    const { apiKeyMasked: _m, ...noMask } = read;
    void _m;
    expect(() => ModelProviderSchema.parse(noMask)).toThrow();
    // 未知键（含 apiKey）被 strip，不进入解析结果
    expect(ModelProviderSchema.parse({ ...read, apiKey: "leak" })).not.toHaveProperty("apiKey");
  });
  it("UpdateModelRequestSchema 全字段可选、apiKey 出现时仍 min(8)", () => {
    expect(UpdateModelRequestSchema.parse({})).toEqual({});
    expect(UpdateModelRequestSchema.parse({ enabled: false }).enabled).toBe(false);
    expect(() => UpdateModelRequestSchema.parse({ apiKey: "short" })).toThrow();
  });
  it("TestModelRequestSchema 无 enabled；TestModelResponseSchema 形状", () => {
    const r = TestModelRequestSchema.parse({ ...validCreate, enabled: true });
    expect(r).not.toHaveProperty("enabled");
    expect(TestModelResponseSchema.parse({ ok: false, statusCode: 401, error: "HTTP 401" }).ok).toBe(
      false,
    );
  });
});
