import { z } from "zod";

export const ModelTypeSchema = z.enum(["llm", "embedding", "rerank"]);
export type ModelType = z.infer<typeof ModelTypeSchema>;

// 读侧：仅掩码，永不含明文 apiKey；role 不持久化（001:81 权威表无此列，M3 diff D1）
export const ModelProviderSchema = z.object({
  id: z.string().min(1),
  type: ModelTypeSchema,
  provider: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  apiKeyMasked: z.string(),
  deploymentId: z.string().optional(),
  enabled: z.boolean(),
});
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

export const ModelProviderListResponseSchema = z.array(ModelProviderSchema);
export type ModelProviderListResponse = z.infer<typeof ModelProviderListResponseSchema>;

// 写侧：明文 apiKey（HTTPS 内传输，后端加密落库），enabled 缺省 true（抽屉无开关）
export const CreateModelRequestSchema = ModelProviderSchema.omit({
  id: true,
  apiKeyMasked: true,
}).extend({
  apiKey: z.string().min(8),
  enabled: z.boolean().default(true),
});
export type CreateModelRequest = z.infer<typeof CreateModelRequestSchema>;

// PATCH：全可选；apiKey 不传 = 不改。
// 注意不可从 CreateModelRequestSchema.partial() 派生：zod v4 下 .default(true) 经 partial()
// 解析 {} 仍会注入 enabled:true，空 PATCH 会误改开关——故基于无 default 的形状构造。
export const UpdateModelRequestSchema = ModelProviderSchema.omit({
  id: true,
  apiKeyMasked: true,
})
  .extend({ apiKey: z.string().min(8) })
  .partial();
export type UpdateModelRequest = z.infer<typeof UpdateModelRequestSchema>;

// ad-hoc 连通性测试（抽屉保存前验活，不落库）
export const TestModelRequestSchema = CreateModelRequestSchema.omit({ enabled: true });
export type TestModelRequest = z.infer<typeof TestModelRequestSchema>;

export const TestModelResponseSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative().optional(),
  statusCode: z.number().int().optional(),
  error: z.string().optional(),
});
export type TestModelResponse = z.infer<typeof TestModelResponseSchema>;
