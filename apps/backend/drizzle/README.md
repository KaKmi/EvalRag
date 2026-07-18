# drizzle/ — 迁移是**手写**的，`drizzle-kit generate` 已停用

## 现状

- `drizzle/00NN_*.sql` + `drizzle/meta/_journal.json` 是唯一权威，`db:migrate`（`src/db/migrate.ts`）按 `_journal.json` 的 `idx` 顺序执行。
- `drizzle/meta/` 里的**快照链断在 `0021_snapshot.json`**：`0022_eval_w2b.sql` 与 `0023_eval_run_active_slot.sql` 是手写的，没有回写 `00NN_snapshot.json`。
- `src/db/schema.ts` 已经声明了 0023 的 `eval_runs_single_active_unique`（部分唯一索引）。

## 因此：不要跑 `drizzle-kit generate`

drizzle-kit 会以 `0021_snapshot.json` 为基线 diff 当前 `schema.ts`，把 0022 的全部列/约束**和** 0023 的索引一起重新发进一个新迁移文件：

- 在任何已迁过的库上 `db:migrate` 会因 `relation "eval_runs_single_active_unique" already exists` / 重复列而失败；
- 在干净库上则产生与 0023 重复的索引定义。

`package.json` 的 `db:generate` 已指向 `scripts/db-generate-disabled.mjs`（打印上述原因后 `exit 1`），防止有人无意中触发。

## 新增迁移的正确做法

1. 手写 `drizzle/00NN_<描述>.sql`。多语句之间用 `--> statement-breakpoint` 切分（美元引号内的分号不会被误切，`DO $$ ... $$;` 可以整块放）。
2. 在 `drizzle/meta/_journal.json` 的 `entries` 末尾追加：`idx` 连续、`version: "7"`、`when` 单调递增（毫秒时间戳）、`breakpoints: true`、`tag` 与文件名（去 `.sql`）一致。
3. 同步改 `src/db/schema.ts`（Drizzle 查询侧的类型来源）。
4. 验证：`pnpm --filter @codecrush/backend test:db`。各 db spec 都会 `DROP SCHEMA public CASCADE` 后按 `_journal.json` 全量重放迁移 —— 等于每次都做一遍干净库演练；破坏性迁移在这里会当场变红。

## 什么时候可以恢复 `db:generate`

把 `0022_snapshot.json` / `0023_snapshot.json` 补齐（需要与 `schema.ts` 逐字段对得上，且 0023 的部分唯一索引要能被 drizzle-kit 正确表达）之后。在那之前，恢复它等于恢复一颗静默产出破坏性迁移的雷。
