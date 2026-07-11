import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq, isNull, sql } from "drizzle-orm";
import { compilePromptBody, NODE_CONTRACT_VERSION, PromptNodeSchema } from "@codecrush/contracts";
import { prompts, promptVersions, promptVersionTags } from "../modules/prompts/schema";

// 012 Story 2 显式 backfill（迁移 0011 之后、清理迁移 0012 之前运行）：
// 1. 为所有 compile_status 为空的版本用共享编译器计算 contract_version/compile_status/compile_errors；
// 2. 为每个 legacy status='prod' 版本 upsert 恰一个小写 production 标签；
// 3. 幂等：重复运行不产生新写入；
// 4. 校验完成标志，任一缺漏以非零退出（0012 的 DO $$ 前置断言同样会拦）。
// 用法：pnpm --filter @codecrush/backend db:backfill-prompts

const BATCH_SIZE = 200;
export const BACKFILL_ACTOR = "system:backfill-012";

type DB = ReturnType<typeof drizzle>;

export async function runBackfill(db: DB): Promise<{ compiled: number; tagged: number }> {
  let compiled = 0;
  // 有界批次：每轮取一批未编译版本（join 出 node），算完写回，直到取空
  for (;;) {
    const batch = await db
      .select({
        id: promptVersions.id,
        body: promptVersions.body,
        node: prompts.node,
      })
      .from(promptVersions)
      .innerJoin(prompts, eq(promptVersions.promptId, prompts.id))
      .where(isNull(promptVersions.compileStatus))
      .orderBy(promptVersions.id)
      .limit(BATCH_SIZE);
    if (batch.length === 0) break;

    for (const row of batch) {
      const node = PromptNodeSchema.safeParse(row.node);
      if (!node.success) {
        throw new Error(`prompt_versions.id=${row.id} 所属 prompt 的 node 非法：${row.node}`);
      }
      const result = compilePromptBody(row.body, node.data);
      await db
        .update(promptVersions)
        .set({
          contractVersion: NODE_CONTRACT_VERSION,
          compileStatus: result.status,
          compileErrors: result.issues,
        })
        // compile_status 仍为空才写：与并发/重复运行天然幂等
        .where(and(eq(promptVersions.id, row.id), isNull(promptVersions.compileStatus)));
      compiled++;
    }
  }

  // legacy prod → production 标签。ON CONFLICT 目标是 (prompt_id, lower(name)) 表达式唯一索引；
  // 旧状态机保证每 prompt 至多一个 prod 版本，重复运行时 DO NOTHING（已指向即不动）
  const tagged = await db.execute(sql`
    INSERT INTO prompt_version_tags (prompt_id, prompt_version_id, name, created_by)
    SELECT pv.prompt_id, pv.id, 'production', ${BACKFILL_ACTOR}
    FROM prompt_versions pv
    WHERE pv.status = 'prod'
    ON CONFLICT (prompt_id, lower(name)) DO NOTHING
  `);
  return { compiled, tagged: tagged.rowCount ?? 0 };
}

export interface BackfillVerification {
  ok: boolean;
  problems: string[];
}

// 完成断言（plan Story 2）：所有版本 contract_version ≥1、compile_status 合法、
// compile_errors 非空 JSON；每个 legacy prod 行恰有一个指向它的小写 production 标签。
export async function verifyBackfill(db: DB): Promise<BackfillVerification> {
  const problems: string[] = [];

  const badCompile = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM prompt_versions
    WHERE compile_status IS NULL
       OR compile_status NOT IN ('ok', 'has_errors', 'has_warnings')
       OR compile_errors IS NULL
       OR contract_version IS NULL OR contract_version < 1
  `);
  const badCompileCount = Number((badCompile.rows[0] as { n: number }).n);
  if (badCompileCount > 0) {
    problems.push(`${badCompileCount} 个版本缺少合法编译元数据`);
  }

  const prodMissingTag = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM prompt_versions pv
    WHERE pv.status = 'prod'
      AND NOT EXISTS (
        SELECT 1 FROM prompt_version_tags t
        WHERE t.prompt_version_id = pv.id AND t.prompt_id = pv.prompt_id AND t.name = 'production'
      )
  `);
  const prodMissing = Number((prodMissingTag.rows[0] as { n: number }).n);
  if (prodMissing > 0) {
    problems.push(`${prodMissing} 个 legacy prod 版本没有指向自己的 production 标签`);
  }

  return { ok: problems.length === 0, problems };
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  try {
    const { compiled, tagged } = await runBackfill(db);
    console.log(`backfill 完成：编译 ${compiled} 个版本，补 ${tagged} 个 production 标签`);
    const verification = await verifyBackfill(db);
    if (!verification.ok) {
      for (const p of verification.problems) console.error(`校验失败：${p}`);
      process.exitCode = 1;
      return;
    }
    console.log("校验通过：所有版本编译元数据完整，legacy prod 标签齐备");
  } finally {
    await pool.end();
  }
}

// 直接执行时才跑 main（供测试 import runBackfill/verifyBackfill 而不触发连接）
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
