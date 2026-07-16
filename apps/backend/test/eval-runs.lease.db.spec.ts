import { readFileSync } from "fs";
import { join } from "path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { EvalRunsRepository } from "../src/modules/eval-runs/eval-runs.repository";
import {
  EVAL_RUN_LEASE_MS,
  EVAL_RUN_REAP_GRACE_MS,
} from "../src/modules/eval-runs/eval-run.constants";

/**
 * **真库**租约/回收语义（`RUN_DB_TESTS=1` + `MIGRATION_TEST_DATABASE_URL` 时才跑，
 * 形状同 `conversations.evaluation-turn.spec.ts`）。
 *
 * 为什么必须打真库：本文件守的每一条都是 **SQL 三值逻辑**上的性质，fake 复刻不出来 ——
 * peer review 实测过两次：
 *  ① 首版 fake 忠实地复刻了 `lease_until = NULL` 的 BUG，于是「测试与 bug 一起绿」；
 *  ② 把 `releaseLease` 的 `leaseUntil: now` 改回 `null`（= 完整回退那个 P1），
 *    全量 875 条单测**仍然全绿** —— 因为 worker spec 的 `releaseLease()` 是个空 fake。
 * 即：这个修复此前可以被无声回退而 CI 毫无反应。本文件就是钉死它的那颗钉子。
 */

const enabled = process.env.RUN_DB_TESTS === "1" && !!process.env.MIGRATION_TEST_DATABASE_URL;
const describeDb = enabled ? describe : describe.skip;
const migrationsDir = join(__dirname, "..", "drizzle");
jest.setTimeout(180_000);

async function resetAndMigrate(pool: Pool): Promise<void> {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> };
  for (const { tag } of journal.entries) {
    const sql = readFileSync(join(migrationsDir, `${tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) await pool.query(statement.trim());
    }
  }
}

const ID = "11111111-1111-4111-8111-111111111111";

describeDb("eval run lease + reaper（真库三值逻辑）", () => {
  let pool: Pool;
  let repo: EvalRunsRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
    await resetAndMigrate(pool);
    repo = new EvalRunsRepository(drizzle(pool) as never);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM eval_run_results");
    await pool.query("DELETE FROM eval_runs");
    await pool.query("DELETE FROM eval_sets");
    await pool.query(`INSERT INTO eval_sets (id, name, created_by) VALUES ($1, 'set', 't')`, [ID]);
  });

  async function insertRun(status: string, leaseOwner: string | null, leaseUntil: Date | null) {
    const rows = await pool.query(
      `INSERT INTO eval_runs (set_id, application_id, config_version_id, judge_model_id,
         embedding_model_id, case_version_snapshot, created_by, status, lease_owner, lease_until)
       VALUES ($1,$1,$1,$1,$1,'[]'::jsonb,'t',$2,$3,$4) RETURNING id`,
      [ID, status, leaseOwner, leaseUntil],
    );
    return rows.rows[0].id as string;
  }

  const statusOf = async (id: string) =>
    (await pool.query(`SELECT status, lease_owner, lease_until FROM eval_runs WHERE id=$1`, [id]))
      .rows[0];

  const ago = (ms: number) => new Date(Date.now() - ms);

  it("releaseLease 留下**已过期时间戳**而非 NULL —— 回收器赖以判断的证据不能被抹掉", async () => {
    const id = await insertRun("running", "w1", new Date(Date.now() + EVAL_RUN_LEASE_MS));
    await repo.releaseLease(id, "w1");
    const row = await statusOf(id);
    // 这一条就是那个 P1 的钉子：置 NULL 的话，下面的回收器永远看不见这条 run
    // （SQL 里 `NULL < ts` 求值为 NULL 而非 TRUE），run 永久卡 running → 功能死锁。
    expect(row.lease_until).not.toBeNull();
    expect(row.lease_owner).toBeNull();
  });

  it("未捕获异常路径（release 后超过宽限期）→ 被回收成 failed，死锁解除", async () => {
    const id = await insertRun("running", null, ago(EVAL_RUN_REAP_GRACE_MS + 60_000));
    expect(await repo.reapAbandonedRuns(new Date())).toEqual([id]);
    const row = await statusOf(id);
    expect(row.status).toBe("failed");
    // owner 必须一并清掉：否则被误回收的 worker 续租仍成功 → 不让位 → 把结果写进 failed run
    expect(row.lease_owner).toBeNull();
  });

  it("刚 release、pg-boss 正要重试（宽限期内）→ **不**回收，retryLimit:3 不被架空", async () => {
    const id = await insertRun("running", null, new Date());
    expect(await repo.reapAbandonedRuns(new Date())).toEqual([]);
    expect((await statusOf(id)).status).toBe("running");
  });

  it("queued 的 run（lease_until IS NULL）永不被回收 —— 排队中不是僵尸", async () => {
    const id = await insertRun("queued", null, null);
    expect(await repo.reapAbandonedRuns(new Date(Date.now() + 1000 * EVAL_RUN_REAP_GRACE_MS))).toEqual([]);
    expect((await statusOf(id)).status).toBe("queued");
  });

  it("健康 run（租约在未来）不被回收", async () => {
    const id = await insertRun("running", "w1", new Date(Date.now() + EVAL_RUN_LEASE_MS));
    expect(await repo.reapAbandonedRuns(new Date())).toEqual([]);
    expect((await statusOf(id)).status).toBe("running");
  });

  it("终态 run 不被回收（只认 running）", async () => {
    const id = await insertRun("done", null, ago(EVAL_RUN_REAP_GRACE_MS + 60_000));
    expect(await repo.reapAbandonedRuns(new Date())).toEqual([]);
    expect((await statusOf(id)).status).toBe("done");
  });

  it("被回收后 renewLease 返回 false —— worker 据此立刻让位", async () => {
    const id = await insertRun("running", "w1", ago(EVAL_RUN_REAP_GRACE_MS + 60_000));
    await repo.reapAbandonedRuns(new Date());
    expect(await repo.renewLease(id, "w1", new Date(), EVAL_RUN_LEASE_MS)).toBe(false);
  });

  it("release 后重试能立刻重新抢到租约（宽限期不挡重试）", async () => {
    const id = await insertRun("running", "w1", new Date(Date.now() + EVAL_RUN_LEASE_MS));
    await repo.releaseLease(id, "w1");
    // 新 owner（重试是新的 randomUUID）必须能立刻抢到，否则重试要干等一个 TTL。
    expect(await repo.tryAcquireLease(id, "w2", new Date(Date.now() + 1), EVAL_RUN_LEASE_MS)).toBe(
      true,
    );
  });

  it("他人持有且未过期的租约抢不到（全局串行的第二道保险）", async () => {
    const id = await insertRun("running", "w1", new Date(Date.now() + EVAL_RUN_LEASE_MS));
    expect(await repo.tryAcquireLease(id, "w2", new Date(), EVAL_RUN_LEASE_MS)).toBe(false);
  });
});
