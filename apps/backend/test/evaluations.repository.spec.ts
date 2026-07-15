import { readFileSync } from "fs";
import { join } from "path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { EvaluationsRepository } from "../src/modules/evaluations/evaluations.repository";

const enabled = process.env.RUN_DB_TESTS === "1" && !!process.env.MIGRATION_TEST_DATABASE_URL;
const describeDb = enabled ? describe : describe.skip;
const migrationsDir = join(__dirname, "..", "drizzle");
const now = new Date("2026-07-15T02:00:00.000Z");

describeDb("EvaluationsRepository", () => {
  let pool: Pool;
  let repo: EvaluationsRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    const journal = JSON.parse(
      readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    for (const { tag } of journal.entries) {
      const migration = readFileSync(join(migrationsDir, `${tag}.sql`), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await pool.query(statement);
      }
    }
    repo = new EvaluationsRepository(drizzle(pool) as never);
  });

  afterAll(async () => pool?.end());

  it("stores defaults and updates settings", async () => {
    expect((await repo.getSettings()).enabled).toBe(false);
    expect((await repo.updateSettings({ sampleRate: 0.25 }, now)).sampleRate).toBe(0.25);
  });

  it("stores a composite cursor and enforces a renewable lease", async () => {
    const first = await repo.getOrCreateWatermark("online-quality-v1", now);
    expect(first.lastTraceId).toBe("");
    expect(await repo.tryAcquireLease("online-quality-v1", "worker-a", now, 20 * 60_000)).toBe(
      true,
    );
    expect(await repo.tryAcquireLease("online-quality-v1", "worker-b", now, 20 * 60_000)).toBe(
      false,
    );
    await repo.finishCycle("online-quality-v1", "worker-a", {
      lastTs: new Date("2026-07-15T01:00:00.000Z"),
      lastTraceId: "f".repeat(32),
      evaluatedIncrement: 4,
      now,
    });
    const saved = await repo.getOrCreateWatermark("online-quality-v1", now);
    expect(saved.lastTraceId).toBe("f".repeat(32));
    expect(saved.dailyCount).toBe(4);
    expect(saved.leaseOwner).toBeNull();
  });
});
