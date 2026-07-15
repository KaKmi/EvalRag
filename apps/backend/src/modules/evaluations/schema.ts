import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const onlineEvalSettings = pgTable(
  "online_eval_settings",
  {
    id: varchar("id", { length: 64 }).primaryKey().default("default"),
    enabled: boolean("enabled").notNull().default(false),
    sampleRate: numeric("sample_rate", { precision: 5, scale: 4, mode: "number" })
      .notNull()
      .default(0.1),
    judgeModelId: uuid("judge_model_id"),
    embeddingModelId: uuid("embedding_model_id"),
    faithfulnessThreshold: smallint("faithfulness_threshold").notNull().default(85),
    answerRelevancyThreshold: smallint("answer_relevancy_threshold").notNull().default(80),
    contextPrecisionThreshold: smallint("context_precision_threshold").notNull().default(80),
    dailyCap: integer("daily_cap").notNull().default(500),
    judgeVersion: varchar("judge_version", { length: 100 }).notNull().default("online-v1"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("online_eval_settings_sample_rate_check", sql`${table.sampleRate} BETWEEN 0 AND 1`),
    check(
      "online_eval_settings_faithfulness_threshold_check",
      sql`${table.faithfulnessThreshold} BETWEEN 0 AND 100`,
    ),
    check(
      "online_eval_settings_answer_relevancy_threshold_check",
      sql`${table.answerRelevancyThreshold} BETWEEN 0 AND 100`,
    ),
    check(
      "online_eval_settings_context_precision_threshold_check",
      sql`${table.contextPrecisionThreshold} BETWEEN 0 AND 100`,
    ),
    check("online_eval_settings_daily_cap_check", sql`${table.dailyCap} BETWEEN 1 AND 10000`),
  ],
);

export const evalWatermarks = pgTable("eval_watermarks", {
  workerName: varchar("worker_name", { length: 100 }).primaryKey(),
  lastTs: timestamp("last_ts", { withTimezone: true }).notNull(),
  lastTraceId: varchar("last_trace_id", { length: 32 }).notNull().default(""),
  dailyDate: date("daily_date", { mode: "string" }).notNull(),
  dailyCount: integer("daily_count").notNull().default(0),
  leaseOwner: varchar("lease_owner", { length: 200 }),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OnlineEvalSettingsRow = typeof onlineEvalSettings.$inferSelect;
export type EvalWatermarkRow = typeof evalWatermarks.$inferSelect;
