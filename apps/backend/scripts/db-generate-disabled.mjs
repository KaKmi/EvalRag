#!/usr/bin/env node
/**
 * `db:generate` 的**故意失败**替身（review P3：快照链断在 0021）。
 *
 * 为什么不是简单删掉脚本：删掉只会让下一个人直接跑 `npx drizzle-kit generate`，
 * 踩同一个坑还少了这段解释。让它响亮地失败并说清原因，才是真正的守护。
 *
 * 详细背景见 drizzle/README.md。
 */
console.error(`
drizzle-kit generate 在本仓库已停用。

原因：drizzle/meta 的快照链断在 0021_snapshot.json，而 0022 / 0023 是**手写迁移**
（0023 还带一个 drizzle-kit 生成不出来的部分唯一索引 + fail-fast 守卫 DO 块），
src/db/schema.ts 也已声明 0023 的 eval_runs_single_active_unique。

于是 drizzle-kit 会以 0021 为基线 diff 当前 schema，把 0022 的全部列/约束**和**
0023 的索引一起重新发进一个新迁移文件：
  - 在任何已迁过的库上 db:migrate 会因 "relation ... already exists" 失败；
  - 在干净库上则产生与 0023 重复的索引定义。

正确做法：**手写**一个新的 drizzle/00NN_*.sql，并在 drizzle/meta/_journal.json 追加
对应条目（idx 连续、version "7"、when 单调递增、breakpoints true），照 0022/0023 的样子写。
写完用 pnpm --filter @codecrush/backend test:db 验证（各 db spec 会 DROP SCHEMA 后
按 _journal.json 全量重放迁移，等于一次干净库演练）。
`);
process.exit(1);
