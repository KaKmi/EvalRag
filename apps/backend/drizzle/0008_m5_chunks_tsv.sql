-- 手写迁移（同 0006 HNSW 索引先例）：drizzle-kit 推导不出自定义函数与生成列表达式，
-- 生成的 ADD COLUMN 占位已替换为真实 DDL。设计依据 docs/design/008 §中文分词方案。

-- cjk_bigram_text：先按「CJK 连续段 / 非 CJK 非空白连续段」切 run——CJK run 两两重叠切分
-- （单字 run 保留单字），非 CJK run（英文词/数字）整词原样保留，不逐字符拆
-- （逐字符拆会让英文查询退化成"共享任意字母即命中"的噪声匹配）。
-- 供 tsv 生成列与 searchByKeyword 查询侧共用（避免 TS/SQL 两处重复分词逻辑）。
CREATE OR REPLACE FUNCTION cjk_bigram_text(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT string_agg(
    CASE
      WHEN tok ~ '^[一-鿿]' AND length(tok) > 1 THEN
        (SELECT string_agg(substr(tok, j, 2), ' ')
           FROM generate_series(1, length(tok) - 1) AS j)
      ELSE tok
    END, ' ' ORDER BY ord)
  FROM (
    SELECT m[1] AS tok, ord
    FROM regexp_matches(input, '[一-鿿]+|[^一-鿿[:space:]]+', 'g') WITH ORDINALITY AS r(m, ord)
  ) runs;
$$;
--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', cjk_bigram_text("text"))) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_tsv_gin_idx" ON "chunks" USING gin ("tsv");
