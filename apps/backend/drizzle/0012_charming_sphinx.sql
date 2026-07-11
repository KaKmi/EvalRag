-- 012 Story 4 破坏性清理迁移（仅停机同步升级窗口执行；滚动多版本部署须拆独立 release）。
-- 前置断言：backfill（db:backfill-prompts）必须已完成，否则 RAISE EXCEPTION 使迁移整体回滚。
DO $$
DECLARE
  bad_compile int;
  prod_missing_tag int;
  orphan_tags int;
BEGIN
  -- 1. 所有版本必须有合法编译元数据（compile_status/compile_errors/contract_version）
  SELECT COUNT(*) INTO bad_compile FROM prompt_versions
  WHERE compile_status IS NULL
     OR compile_status NOT IN ('ok', 'has_errors', 'has_warnings')
     OR compile_errors IS NULL
     OR contract_version IS NULL OR contract_version < 1;
  IF bad_compile > 0 THEN
    RAISE EXCEPTION '0012 前置失败：% 个 prompt_versions 缺少合法编译元数据，先运行 db:backfill-prompts', bad_compile;
  END IF;

  -- 2. 每个 legacy prod 版本必须恰有一个指向自己的小写 production 标签
  SELECT COUNT(*) INTO prod_missing_tag FROM prompt_versions pv
  WHERE pv.status = 'prod'
    AND (SELECT COUNT(*) FROM prompt_version_tags t
         WHERE t.prompt_id = pv.prompt_id AND t.prompt_version_id = pv.id
           AND t.name = 'production') <> 1;
  IF prod_missing_tag > 0 THEN
    RAISE EXCEPTION '0012 前置失败：% 个 legacy prod 版本缺少 production 标签，先运行 db:backfill-prompts', prod_missing_tag;
  END IF;

  -- 3. 标签/版本复合归属不得有非法行（复合 FK 理应保证，此处双保险）
  SELECT COUNT(*) INTO orphan_tags FROM prompt_version_tags t
  WHERE NOT EXISTS (
    SELECT 1 FROM prompt_versions pv
    WHERE pv.id = t.prompt_version_id AND pv.prompt_id = t.prompt_id
  );
  IF orphan_tags > 0 THEN
    RAISE EXCEPTION '0012 前置失败：% 个标签的版本归属非法', orphan_tags;
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX "prompt_versions_prompt_id_status_idx";--> statement-breakpoint
ALTER TABLE "prompt_versions" ALTER COLUMN "compile_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_versions" ALTER COLUMN "compile_errors" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_versions" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "prompts" DROP COLUMN "current_version_id";
