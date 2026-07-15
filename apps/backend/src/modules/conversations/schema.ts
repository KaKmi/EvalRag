import type { FallbackInfo } from "@codecrush/contracts";
import {
  bigserial,
  boolean,
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// 域内 schema：零 service 引用（003 不变量 8）。对齐 013 Design「会话持久化」。
// agentId/userId 落 text 不 FK：agentId 语义上指向 applications，但 M8 阶段会话按逻辑标识隔离，
// 不做级联删除（应用删除后历史会话保留可审计），同 chunkTemplate「text 落库、契约层收口」先例。
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: text("agent_id").notNull(),
  userId: text("user_id"),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sequence: bigserial("sequence", { mode: "number" }).notNull().unique(),
    convId: uuid("conv_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // "user" | "assistant"（契约层 MessageRoleSchema 收口）
    content: text("content").notNull(),
    traceId: text("trace_id"),
    confidence: real("confidence"),
    coverage: text("coverage"), // "full" | "partial"
    isFallback: boolean("is_fallback"),
    fallbackInfo: jsonb("fallback_info").$type<FallbackInfo>(),
    citations: jsonb("citations").$type<string[]>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    convIdIndex: index("messages_conv_id_idx").on(t.convId),
    convIdSequenceIndex: index("messages_conv_id_sequence_idx").on(t.convId, t.sequence),
  }),
);

export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
