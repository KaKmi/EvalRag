/**
 * 迁移 0025（人工「立即评测」作业表）的 Postgres 集成测试（RUN_DB_TESTS=1 门控）。
 *
 * 本波最关键的一钉在第三条：**人工评测绝不进 eval_candidate_ledger**。
 * 账本记的是游标推进语义，人工旁路不推进游标；混进去会污染屏1 的
 * missedBreakdown / scoresNotPersisted 口径（countLedgerByOutcome 不按 workerName 过滤）。
 */
import { readFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { dbGate } from "./helpers/gated-suite";

const describeDb = dbGate();
jest.setTimeout(180_000);

// 必须自包含：同套件里的迁移 spec 会 DROP SCHEMA public CASCADE，
// 依赖「库里已经迁好了」会出现「单跑绿、全套件红」（本波已在 0024 上踩过一次）。
const MIGRATIONS_DIR = join(__dirname, "..", "drizzle");

function journalTags(): string[] {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  return journal.entries.map((e) => e.tag);
}

async function applyMigrations(pool: Pool): Promise<void> {
  for (const tag of journalTags()) {
    const text = readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), "utf8");
    for (const raw of text.split("--> statement-breakpoint")) {
      const stmt = raw.trim();
      if (stmt) await pool.query(stmt);
    }
  }
}

async function resetSchema(pool: Pool): Promise<void> {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
}

describeDb("0025 eval_manual_score_jobs（RUN_DB_TESTS=1）", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
    await resetSchema(pool);
    await applyMigrations(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("表存在且主键为 (target_trace_id, judge_version)", async () => {
    const { rows } = await pool.query(
      `SELECT a.attname
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'eval_manual_score_jobs'::regclass AND i.indisprimary
        ORDER BY a.attname`,
    );
    expect(rows.map((r) => r.attname)).toEqual(["judge_version", "target_trace_id"]);
  });

  it("status CHECK 只认四态", async () => {
    await expect(
      pool.query(
        `INSERT INTO eval_manual_score_jobs (target_trace_id, judge_version, status, requested_by)
         VALUES ($1,'online-v2','bogus','t@example.com')`,
        ["c".repeat(32)],
      ),
    ).rejects.toThrow(/eval_manual_score_jobs_status_check/);
  });

  it("与 eval_candidate_ledger 是两张独立表 —— 人工评测不进账本", async () => {
    const trace = "d".repeat(32);
    await pool.query(
      `INSERT INTO eval_manual_score_jobs (target_trace_id, judge_version, status, requested_by)
       VALUES ($1,'online-v2','queued','t@example.com')
       ON CONFLICT (target_trace_id, judge_version) DO NOTHING`,
      [trace],
    );
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM eval_candidate_ledger WHERE target_trace_id = $1`,
      [trace],
    );
    expect(rows[0].n).toBe(0);
    await pool.query(`DELETE FROM eval_manual_score_jobs WHERE target_trace_id = $1`, [trace]);
  });

  it("同一 (trace, judgeVersion) 二次插入走主键冲突（重试靠 upsert 而非重复建行）", async () => {
    const trace = "e".repeat(32);
    const insert = () =>
      pool.query(
        `INSERT INTO eval_manual_score_jobs (target_trace_id, judge_version, status, requested_by)
         VALUES ($1,'online-v2','queued','t@example.com')`,
        [trace],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/eval_manual_score_jobs_pk/);
    await pool.query(`DELETE FROM eval_manual_score_jobs WHERE target_trace_id = $1`, [trace]);
  });
});
