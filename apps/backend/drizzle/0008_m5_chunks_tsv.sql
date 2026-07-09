-- 手写迁移（同 0006 HNSW 索引先例）：drizzle-kit 推导不出自定义函数与生成列表达式，
-- 生成的 ADD COLUMN 占位已替换为真实 DDL。设计依据 docs/design/008 §中文分词方案。

-- cjk_bigram_text：中文字符两两重叠切分，非中文字符原样保留；
-- 供 tsv 生成列与 searchByKeyword 查询侧共用（避免 TS/SQL 两处重复分词逻辑）。
CREATE OR REPLACE FUNCTION cjk_bigram_text(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT string_agg(
    CASE
      WHEN substr(input, i, 1) ~ '[一-鿿]' AND i < length(input)
        THEN substr(input, i, 2)
      ELSE substr(input, i, 1)
    END, ' ')
  FROM generate_series(1, length(input)) AS i;
$$;
--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', cjk_bigram_text("text"))) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_tsv_gin_idx" ON "chunks" USING gin ("tsv");
