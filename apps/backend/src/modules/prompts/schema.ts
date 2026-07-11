import { sql } from "drizzle-orm";
import {
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { CompileIssue } from "@codecrush/contracts";

// 域内 schema：零 service 引用（003 不变量 5 / AGENTS.md 不变量 8），防循环 import。
// 012 重构：版本平权 + 排他标签。0011 加法迁移 + backfill 后，0012 清理迁移已删
// status/current_version_id 旧列并将 compile 列收紧 NOT NULL（仅停机同步升级）。

export const prompts = pgTable("prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  node: text("node").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    // variables jsonb（001:88）；.$type<string[]> 仅 TS 层断言，运行时 jsonb
    variables: jsonb("variables").notNull().default([]).$type<string[]>(),
    // 012 新增：PromptVersion 固定静态契约版本（001/011 不变量）
    contractVersion: integer("contract_version").notNull().default(1),
    // 012：保存时服务端跑 compilePromptBody() 的结果（0012 起 NOT NULL）
    compileStatus: text("compile_status").notNull(),
    compileErrors: jsonb("compile_errors").notNull().$type<CompileIssue[]>(),
    note: text("note"),
    author: text("author").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    // D8：unique(promptId, version) 兜底并发撞号
    uniqPromptVersion: uniqueIndex("prompt_versions_prompt_id_version_idx").on(
      t.promptId,
      t.version,
    ),
    // 012：供 prompt_version_tags 复合 FK 引用（标签行的 version 必须属于同一 prompt，DB 级排他）
    uniqPromptIdId: uniqueIndex("prompt_versions_prompt_id_id_uniq").on(t.promptId, t.id),
  }),
);

// 012 §1 排他标签表：同一 Prompt 下同名标签唯一（大小写不敏感），移动 = ON CONFLICT upsert 原子语句。
// prompt_id 是必须的冗余列——排他唯一约束必须落在本表列上才能拿到 DB 级并发保证（Invariant 5）。
export const promptVersionTags = pgTable(
  "prompt_version_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    promptVersionId: uuid("prompt_version_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (t) => ({
    // 排他性落点：lower(name) 表达式索引保证大小写不敏感唯一；服务边界同时归一 lowercase
    uniqPromptTagName: uniqueIndex("prompt_version_tags_prompt_id_lower_name_idx").on(
      t.promptId,
      sql`lower(${t.name})`,
    ),
    // 复合 FK：标签指向的版本必须属于同一 prompt（跨 Prompt 标签在 DB 层直接拒绝）；
    // 版本删除时标签级联删
    versionOwnershipFk: foreignKey({
      columns: [t.promptVersionId, t.promptId],
      foreignColumns: [promptVersions.id, promptVersions.promptId],
      name: "prompt_version_tags_version_owner_fk",
    }).onDelete("cascade"),
  }),
);

export type PromptRow = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
export type PromptVersionRow = typeof promptVersions.$inferSelect;
export type NewPromptVersion = typeof promptVersions.$inferInsert;
export type PromptVersionTagRow = typeof promptVersionTags.$inferSelect;
export type NewPromptVersionTag = typeof promptVersionTags.$inferInsert;
