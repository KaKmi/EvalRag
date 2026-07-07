import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// 域内 schema：零 service 引用（003 不变量 5）。表形状对齐 001:81：
// model_providers(id, type[llm/embedding/rerank], provider, name, base_url, api_key_enc, deployment_id, enabled)
// created_at/updated_at 为工程簿记列（users/prompts 同例）；role 不落库（001:81 无此列，M3 diff D1）。
export const modelProviders = pgTable("model_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(), // "llm" | "embedding" | "rerank"
  provider: text("provider").notNull(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKeyEnc: text("api_key_enc").notNull(), // EncryptionService v1 envelope，永不存明文
  deploymentId: text("deployment_id"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type ModelProviderRow = typeof modelProviders.$inferSelect;
export type NewModelProvider = typeof modelProviders.$inferInsert;
