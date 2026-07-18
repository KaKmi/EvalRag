-- 018 §12 缺口 13：把「全局同时最多 1 个 run」从 check-then-insert 变成 PG 约束。
--
-- fail-fast 而不是自动收拾现场：库里已有 ≥2 条活跃 run 时，究竟该保留哪一条
-- 需要人的判断——按 created_at 取最早的那条可能保留一条早已被遗弃的 queued 孤儿，
-- 而把一条正在跑、正在产出结果行的 running run 判死（queued 臂之所以要叠加租约
-- 证据，正是因为「created_at 早」与「还活着」无关）。迁移是显式命令
-- （AGENTS.md 边界 9），操作者在场，报错即可处置。
--
-- 判据取 >1 而不是 0022 那样的 >0：单条活跃 run 与本索引完全相容（已真库实测）。
DO $$
DECLARE active_count int;
BEGIN
  SELECT count(*) INTO active_count FROM eval_runs WHERE status IN ('queued', 'running');
  IF active_count > 1 THEN
    RAISE EXCEPTION '存在 % 条活跃 eval_runs（queued/running），无法建立全局单活跃槽位唯一索引；请先等它们跑完或收成终态后重试', active_count;
  END IF;
END $$;
--> statement-breakpoint
-- 索引表达式在部分索引内恒为 true ⇒ 至多一行进入活跃槽位。
-- 终态行不在谓词内 ⇒ 不占槽位；同一行 queued→running 不违反唯一性（索引键不变）。
CREATE UNIQUE INDEX "eval_runs_single_active_unique"
  ON "eval_runs" ((status IN ('queued','running')))
  WHERE status IN ('queued','running');
