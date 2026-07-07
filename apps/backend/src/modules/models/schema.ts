import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// 域内 schema：零 service 引用（003 不变量 5）。表形状对齐 001:81（协议化修订）：
// model_providers(id, type, protocol, name, base_url, api_key_enc, deployment_id, params jsonb, enabled)
// 无 provider（厂商）字段——(type, protocol) 是运行期请求构造的路由键（001「协议格式为路由键」）。
// created_at/updated_at 为工程簿记列（users/prompts 同例）；role 不落库（001:81 无此列）。
export const modelProviders = pgTable("model_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(), // "llm" | "embedding" | "rerank"
  protocol: text("protocol").notNull(), // ModelProtocol 枚举值（契约层收口合法组合）
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKeyEnc: text("api_key_enc").notNull(), // EncryptionService v1 envelope，永不存明文
  deploymentId: text("deployment_id"),
  // 按类型的默认调用参数，值统一为字符串（契约 params: record<string,string>）
  params: jsonb("params").notNull().default({}).$type<Record<string, string>>(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type ModelProviderRow = typeof modelProviders.$inferSelect;
export type NewModelProvider = typeof modelProviders.$inferInsert;
