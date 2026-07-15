# 017 在线答案质量评测

状态：E-W1 实施基线（2026-07-15）

## 目标与边界

对已经完成的真实、非 preview 问答异步抽样，使用独立 Judge 计算忠实度、回答相关性和上下文精确率，并通过既有 OTLP→ClickHouse 链路形成总览与 Trace 只读质量视图。评测不修改、不等待也不阻塞问答关键路径。

E-W1 包含周期 worker、水位线与分层抽样、三指标 Judge、`rag.eval` span、ClickHouse 去重读模型、质量总览、设置、Trace 列表筛选排序及详情面板。不包含手动单条评分、重试按钮、gold 评测集、离线 run、问题池、重放、发布门禁和聚类。

## 依赖与边界

```text
chat ──OTLP──► Collector ──► ClickHouse ◄── evaluations candidate/read model
   │                                      │
   └── Postgres conversation/chunk text ──┤
models public service ──► evaluations ──► rag.eval span
queue + evaluations control plane ───────► evaluations worker
```

`evaluations` 只能消费 conversations、chunks、models 暴露的公共 service/端口，不直接导入其他域的 repository、schema 或 adapter；`evaluations` 与 `traces` 不互相依赖。两者只共享 contracts、OTel conventions 和 ClickHouse 事实数据。

## 调度、游标与抽样

- pg-boss 每 15 分钟调度一次；候选上界固定为 `now-5min`，只取完成且 `rag.preview != true` 的根 Trace。
- 水位线是 `(start_time, trace_id)` 复合游标。首次启用最多回看 24 小时；一个批次全部处理完才推进。
- Postgres 保存单例 settings、watermark、lease owner/expiry、连续失败与最近周期状态。租约使用条件更新，防止多实例重复消费；崩溃后旧水位重放。
- 高风险（failed、fallback、无引用、confidence `<0.6`）100% 抽样；普通流量使用 target trace 的稳定 hash 与 `sampleRate` 判定。默认 10%，每日默认上限 500；接近上限只降低普通流量采样。
- 幂等键为 `SHA-256(targetTraceId + ":" + judgeVersion)`。worker 的先查后写只用于节省成本，最终一致性由 ClickHouse 按 target+version 去重保证。

## Judge 输入与指标

Judge 输入来自 Postgres 中未脱敏的问题与答案、ClickHouse 命中的 chunk id/分数，以及 Postgres 中对应 chunk 正文。Judge 固定 `temperature=0`。

- Faithfulness：抽取答案中的可验证主张，逐条判断是否被检索上下文支持，`supportedClaims / claims × 100`；没有可验证主张时由结构化输出明确给分并说明。
- Answer Relevancy：从答案生成其所回答的问题，将生成问题与原问题 embedding 的 cosine similarity 映射到 0–100。
- Context Precision：判断各命中 chunk 是否与问题相关，按排名前缀 precision 的 relevant-position 平均值计算 0–100。

每个 LLM evaluator 使用 Zod 校验结构化输出，失败只重试一次；任一 metric 仍失败则整条 evaluation 失败，不聚合部分分数。默认阈值为 85/80/80；任一指标 `<70` 时 `evalVerdict=low`。算法、prompt、模型组合或解析契约变化必须提升 `judgeVersion`。

## Postgres 控制面

```sql
online_eval_settings(
  id primary key, enabled, sample_rate, judge_model_id, embedding_model_id,
  faithfulness_threshold, answer_relevancy_threshold, context_precision_threshold,
  daily_cap, judge_version, updated_at
)

online_eval_watermarks(
  id primary key, watermark_time, watermark_trace_id,
  lease_owner, lease_expires_at, consecutive_failures,
  last_cycle_status, last_error, updated_at
)
```

迁移只通过 `pnpm db:migrate` 显式执行。启用评测前，Judge 与 embedding model 必须同时存在、启用且可用；历史设置中已失效的选择仍返回给前端解释，但不可再次启用。

## `rag.eval` span 契约与隐私

成功 span 使用 `SpanName=rag.eval`，并写入：

- `rag.eval.target_trace_id`
- `rag.eval.faithfulness`
- `rag.eval.answer_relevancy`
- `rag.eval.context_precision`
- `rag.eval.judge_model`
- `rag.eval.version`
- `rag.eval.dedupe_key`
- `rag.eval.status=success`
- `gen_ai.agent.id` 与 `gen_ai.request.model`

失败 span 只额外写标准 `error.type`、`error.message`，状态为 `failed`，不持久化部分分数。证据经过限长 JSON 写入受现有 redactor 保护的 `codecrush.io.output`；禁止创建未受保护的 evidence 属性，禁止写入完整 Judge 输入或 chunk 正文。邮箱、手机号、身份证和银行卡号在导出前脱敏。

## ClickHouse 读模型

物化视图只消费 `rag.eval`。物理聚合键包含 target trace 与 judge version，保存 `argMaxState` 分数、模型、状态和时间。查询必须先在 target+version 层执行 `argMaxMerge` 去重，再在当前版本与时间窗口外层执行 `avg/count/quantile`；不得直接对原始重复 span 聚合。趋势 bucket 在去重后计算，跨版本不计算 delta。

Trace 详情优先返回跨版本最新 success，并标记是否为当前版本；没有 success 才读取最新 failed；两者均无则 unscored。列表只将当前选定版本的最新 success 作为质量列事实，排序为所选指标主键、NULLS LAST，再以时间和 trace id 稳定排序。

## API

- `GET /eval/quality/overview?from&to&agentId?`：窗口不超过 30 天，返回运行状态、三指标、趋势、分应用和低分样本；样本数 `<20` 时 previous delta 为 null。
- `GET /eval/quality/traces/:traceId`：返回 scored/unscored/failed 三态。
- `GET /eval/quality/settings`：返回设置与 Judge/embedding 可选项。
- `PUT /eval/quality/settings`：更新设置，启用时校验两类模型。
- Trace list 增加 `evalMetric/evalMax/evalVerdict/evalSort`，行数据增加 evaluation summary。

## 失败、容量与回滚

- Queue、Judge、OTLP 或 ClickHouse 故障都不得影响 chat；worker 记录失败并保留旧水位，租约到期后安全重跑。
- 模型不可用时暂停并暴露 `model_unavailable`；积压暴露 `lagging`；预算降采样暴露 `budget_reduced`。
- 设计容量按 ≤10 QPS、15 分钟周期、默认每日 500 条评测。批量读取原文与 chunk，限制并发和 evidence 体积。
- 回滚先禁用 settings 并停止 schedule；历史 `rag.eval` 与聚合数据保留。代码回滚不删除新增表或属性，迁移保持前向兼容；需要重算时按 judgeVersion 建新口径。

## 验收不变量

1. chat 路径零同步评测等待。
2. 重复 target+version 只计一次，最新写入获胜。
3. preview 永不进入候选。
4. Judge 使用 PG 原文，证据通过标准输出键脱敏。
5. 页面和 Trace API 使用同一 ClickHouse 读模型事实。
