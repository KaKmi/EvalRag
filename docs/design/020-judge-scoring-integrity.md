---
title: "Judge scoring integrity v2"
description: "让 faithfulness 未评分在在线/离线、OTLP、ClickHouse、API 与 UI 全链路保持为 null，并以 v2 解析契约修复长答案确定性拒绝。"
category: "design"
number: "020"
status: current
services: [backend, frontend, infra]
related: ["design/002", "design/017", "design/018"]
last_modified: "2026-07-18"
---

# 020 — Judge scoring integrity v2

## Status

current——v2 evaluator、OTLP/ClickHouse null 语义、API/UI 与 PostgreSQL 迁移均已实现并验证。对应迁移为 `0021_judge_scoring_v2`。

> ## ⚠️ 2026-07-18 修订：D2 的原始假设被真实调用证伪，本条记录第二轮修复
>
> **原始假设（本文档首版）**：长答案确定性拒绝的根因是 `claims .max(20)` 上限——裁判拆出的
> 主张数超过 20 条即被 Zod 拒绝，改成 `.max(100)` 即可解决。**该假设已被真实数据证伪。**
>
> **证伪证据**：对 4 条曾经失败的长答案（438~1290 字）各真实调用裁判 3 次，直接量出实际
> 拆解出的主张数——`13,6,5 / 7,6,(解析失败) / 9,5,(解析失败) / (解析失败)×2,(provider错误)`，
> **没有一次接近 20，更别说 100**。`.max(100)` 上线后，32 条真实候选里仍有 6~7 条失败，
> 且失败的具体是哪几条**在多次重跑间不稳定**——这两点合起来说明问题不是"数量超限"。
>
> 抓取失败时裁判的原始输出（而非只看外层错误信息）后，真实分布是：
>
> | 失败模式 | 占比（12 次诊断样本） | 表现 |
> |---|---|---|
> | `reason` 字段被漏写 | 4/12 | 模型只给 `{claim, supported}`，`reason` 整个不见了 |
> | 字段名近义词漂移 | 2/12 | `supported` 被写成 `support`/`supporting` |
> | 顶层裸数组 | 3/12 | 模型省了 `{claims:...}` 外层包装，直接吐 `[...]` |
> | JSON 被截断 | 2/12 | `max_tokens=2048` 偏紧，密集答案撑爆输出预算 |
> | provider 空响应 | 1/12 | DeepSeek 官方文档承认的已知抖动 |
>
> **零次**是因为数量或字符数超限。`D2` 段落改的数字（20→100、300→500）本身无害（业内
> 惯例也是给足余量），但**不是本案的解药**——真正的根因是裁判输出的**结构本身**在漂移，
> 不是长度。
>
> **第二轮修复（本次落地）**：
> 1. **归一化层**（`faithfulness.evaluator.ts` 的 `normalizeFaithfulnessOutput`，校验前跑）：
>    顶层裸数组自动包一层 `{claims:...}`；`supported` 容许 `support`/`supporting` 近义词；
>    `reason` 缺失给兜底文案，不再让整条记录作废。**真正缺失（连近义词都没有）仍然拒收**，
>    不悄悄猜一个值——归一化只处理命名/结构漂移，不发明缺失的判断。
> 2. **重试改成"修复式"**（`evaluation-judge.utils.ts` 的 `withJudgeRetry`/`repairInstruction`）：
>    `RetriableJudgeError` 携带模型上次的原始输出；重试时把"你上次说了什么、具体哪条规则
>    违反了"拼进新的 user 轮次，而不是原样重发同一个 prompt——对系统性倾向（同输入两次抽到
>    同一个错）有效，对纯随机噪声无害。`ChatMessage.role` 只有 `system|user`，未新增
>    `assistant` 角色（改动收在 evaluations 模块内，不牵动 models port 与三个 adapter）。
> 3. **不再发 `strict: true`**（`structuredOutput()`）：DeepSeek 官方 issue #1069 实锤——开
>    `strict` 反而会让返回的 JSON **语法本身损坏**（首个属性名缺闭合引号），且其官方 JSON
>    输出文档的唯一承诺就是"合法 JSON 字符串"，不保证字段完整/类型正确。这条 flag 在这家
>    provider 上只有实证的坏处。
> 4. **`max_tokens` 2048→8192**（`model_providers.params`，运维配置，非代码）：截断案例的
>    报错位置（约 3019 字符）显示预算确实偏紧。
> 5. **`MAX_ATTEMPTS` 2→3**（`evaluation-judge.utils.ts`）：provider 偶发空响应属真随机噪声，
>    2 次预算里若连续两次都撞上纯属倒霉，一次真正的修复重试机会都没轮到。13 处测试断言的
>    "恰好 2 次调用"随之改为区分"第二次即成功"（不受影响）与"耗尽全部重试才失败"（改为 3）。
>
> **真实验证（不只是单元测试）**：删水位线 + `ONLINE_EVAL_BACKFILL_WINDOW_HOURS=-1`，用改完
> 的正式代码对全部 32 条真实 trace 重新评一遍：
>
> | | 第一轮修复（.max(100)） | 第二轮修复（结构化 + 修复重试） |
> |---|---|---|
> | 裁判失败数 | 6~7/32（不稳定） | **0/32** |
> | 曾失败的 10 条长答案 | 时好时坏 | **10/10 全部拿到真实分数** |
> | 事实一致性均分 | 67（被空/兜底答案的假 100 污染） | **85**（`sampleCount=12`，只由真答案算出） |
>
> 离线路径（屏3 评测集）额外用一次真实 `POST /eval/runs` 端到端验证——`scoreOffline` 调的是
> 同一批 evaluator 实例，理论上必然同时受益；真跑一次确认 `Promise.allSettled` 编排/
> `decideVerdict`/报告页在真实数据下也正确（一条用例四指标全部真实评出，`correctness=67`；
> 另一条因编排层超时被 018 决策 C-3 的既有不变式正确判定为 `unscored`，与裁判修复无关）。

## Summary

现有 faithfulness 把空 claims 记 100，同时用 20 条 claims / 300 字 generated field 的结构化
输出上限确定性拒绝长答案。实测结果是空/兜底短答拿满分，真实长答案无分，质量指标方向反转。
本设计把“没有可信分数”定义为**未评**，在领域/API 使用 `null`，在不可空的 ClickHouse
Float64 聚合状态内使用保留哨兵 `-1`，并在所有读模型第一层立即还原为 NULL。解析契约升为
`online-v2` / `offline-v2`，历史 v1 不重写。

## Goals / Non-goals

**Goals**：空 claims 不进均分；长答案在有界 v2 schema 内可解析；在线高风险候选仍完整评测
answer relevancy/context precision；所有读模型、筛选、排序、minimum 与 UI 忠实表达未评；版本迁移
不让运行中的 v1 离线 run 被 v2 evaluator 续跑。

**Non-goals**：不改变抽样风险分类、游标推进、租约、账本、离线 C-3 空答案守卫、离线 timeout、
`scoreOffline` 的 allSettled 隔离、离线 verdict；不自动回补历史在线流量；不重建 ClickHouse
物理聚合表。

## Design

### D1 intentional null 是成功结果，不是裁判失败

- `FaithfulnessEvaluator.score()` 返回 `MetricResult | null`；claims 为空返回 null，不 throw。
- 在线 `EvaluationJudgeService.score(..., { skipFaithfulness })` 只可跳过 faithfulness；另外两项
  仍按现有顺序执行。真正被调用的 evaluator 抛错仍使整条在线 evaluation 失败。
- 在线 fallback、failed、`noCitations=true` 跳过 faithfulness；低置信度 success 不跳过。
  eligibility 判据固定为 `status === "success" && !noCitations`，不从 contexts/confidence 推断，
  也不修改 `classifyRisk`。
- `EvaluationScores.faithfulness` 与公开评分结果为 `number | null`；未评时 evidence 不含
  faithfulness 键，不伪造“No evidence”。离线自然继承 fulfilled-null 分支，其余指标继续落分。

### D2 v2 structured output 边界

> ⚠️ **本段的诊断已被证伪，修法见 Status 下方 2026-07-18 订正**——数量/长度从来不是长答案
> 拒绝的真实原因（实测最多才拆出 19 条），本段的数字改动本身保留（无害），但不是解药。

- claims 最多 100；prompt 要求合并细碎主张。
- generated string 上限统一为 500：faithfulness claim/reason、answer relevancy question、
  context precision reason、correctness reason；context precision 的 chunkId 边界不变。
- 四个 structured-output name 升为 `evaluation_*_v2`。
- evidence 仍最多 3 条、每条最多 300 字；解析放宽不扩大持久化/展示面。

### D3 Float64 兼容哨兵

- `@codecrush/otel-conventions` 定义 `EVALUATION_UNSCORED_SCORE = -1`；合法 API 分数域仍为
  `[0,100]`。
- 成功 span 对 null faithfulness 显式写 `rag.eval.faithfulness=-1`，不得省略属性。失败 span
  仍不写任何分数。
- `codecrush_eval_targets.faithfulness_state` 保持 `AggregateFunction(argMax, Float64, ...)`；
  不 DROP/ALTER/重建。
- `codecrush_eval_1m`、evaluations latest、traces latest 与 overview 内联 state 读取均在
  `argMaxMerge` 后第一层执行 `nullIf(value, -1)`；repository mapper 再把负值/非有限值归一为
  null。`-1` 不得越过 repository 边界。

选择哨兵而非 Nullable state 是部署兼容决策：当前 ClickHouse DDL 只有 `IF NOT EXISTS`，没有
schema migration runner；直接改聚合 state 类型不会演进存量表，破坏性重建又没有必要。

### D4 聚合、筛选与 minimum

- `sampleCount=count()` 继续表示成功 evaluation trace 总数；另增
  `faithfulnessSampleCount=count(faithfulness)`。
- faithfulness 的 avg、previous delta、样本不足与卡片 n 使用自己的 count；另外两项继续使用
  success 总数。空 faithfulness 集合显式返回 SQL NULL，禁止 NaN。
- trend 同时返回 `faithfulnessSampleCount` 与 `sampleCount`，tooltip 明示两种 n。byAgent
  faithfulness 可 null，总 n 仍是成功 trace 数。
- faithfulness 单项筛选要求非 NULL；排序 NULLS LAST；low/minimum 使用非 NULL 指标，SQL 可用
  `least(ifNull(faithfulness, 101), ...)`。另两项低分时，faithfulness 未评的样本仍可命中 low。
- repository 把 sentinel/负数变 null；service 若仍收到域外负数，视为不变量破坏并抛错，禁止
  clamp 成 0。

### D5 contracts 与 UI

- `QualityScores` 只允许 faithfulness nullable；`QualityThresholds` 是独立的三项非空 0–100
  object，不能再别名到 scores。
- scored Trace detail/summary 与 byAgent 接受 nullable faithfulness；minMetric/minScore 仍必填，
  因另外两项在线成功时必有分。
- Trace 详情用中性灰态“未评”，不参与红/绿阈值判断；Trace 列表继续显示后端从真实数字中算出的
  minimum，不把未评当低质量。

### D6 version 与迁移

- online settings 默认与当前 `online-v1` 行升级为 `online-v2`；仅更新值恰为 online-v1 的行，
  自定义/未来版本不覆盖。
- 新离线 run 默认 `offline-v2`；历史终态 run 保留原 offline-v1。
- PostgreSQL 0021 migration 第一条语句检查 queued/running eval run；存在则 fail fast：
  `judge scoring v2 migration blocked: queued or running eval_runs exist`。部署必须先停 worker 并
  等待或终结活跃 run，不能让同一 run 混用 v1/v2 evaluator。
- migration 不删除/回拨在线 watermark。v2 默认只评新流量；历史回补是单独的预算/运维决策。

## Failure modes

| 场景                     | 行为                                                                |
| ------------------------ | ------------------------------------------------------------------- |
| empty claims             | faithfulness=null；在线仍 success，另外两项保留；离线该指标不进均分 |
| 在线不 eligible          | 完全不调用 faithfulness；不增加 judge failure circuit               |
| 实际 evaluator 失败      | 在线整体 failed；离线仅该指标 null，保持既有差异                    |
| span 丢失/Collector 故障 | 不影响 chat；账本与 `scoresNotPersisted` 继续提供差集证据           |
| sentinel 泄漏到 service  | 抛 RangeError，禁止把 -1 展示或钳成 0                               |
| 迁移时有活跃离线 run     | migration 失败且不改变版本默认/设置                                 |
| v2 当前版本暂时无样本    | UI 显示空态/真实 n=0；不自动重跑历史                                |

## Rollout / rollback

Rollout：先发布权威文档；实现并验证 v2；**停止 worker → 确认无 queued/running run → 执行
`0021_judge_scoring_v2` → 部署 v2 API/worker**；观察 evaluation success/failure、faithfulness
coverage 与 sentinel 泄漏断言。若要
历史回补，单独批准预算后删除指定 watermark，并显式设置
`ONLINE_EVAL_BACKFILL_WINDOW_HOURS=-1`。

Rollback：先禁用在线评测并停止 worker。数据库迁移保持前向兼容，不把默认/历史数据倒回 v1，
也不删除 v2 span；修复后应使用新 judgeVersion，而不是把不同解析契约重新标成 v1。

## Security / privacy

没有新信任边界。Judge 原文仍只在 worker 进程内使用；evidence 继续通过受 redactor 保护的
`codecrush.io.output`，每条最多 300 字；不得新增未保护 evidence 属性或持久化完整 chunk 正文。

## Verification

2026-07-17 静态验证（第一轮修复，D2 的 `.max(20)→.max(100)` 假设当时未被证伪）：`pnpm test`
的 8 个 Turbo task 全绿；`pnpm lint` 0 错误；`pnpm build` 的 5 个包全绿；专用 PostgreSQL
`test:db` 7 suites / 54 tests 全绿；ClickHouse-gated evaluation/trace quality suites 全绿。
迁移测试先证明 active run 会阻断且不改设置，再终结 run 后验证 online-v1→online-v2、自定义
版本不覆盖、两个 v2 默认值及历史 offline-v1 保留。

- evaluator 边界：empty/100/101 claims，500/501 generated strings，evidence 3×300。
- 在线 eligibility、failure circuit、cursor/lease/ledger 回归；离线 fallback/C-3/allSettled 回归。
- contracts/service/frontend 的 nullable 与独立 count；threshold null 必须拒绝。
- ClickHouse 混合 v1 完整分数与 v2 sentinel，覆盖 overview/trend/byAgent/latest/low/filter/sort/
  backfill。
- migration 真库验证 active-run guard、默认值、自定义 online version 与历史 offline-v1。
- 全仓 `pnpm test`、`pnpm lint`、`pnpm build`。

**⚠️ 上述静态验证在第一轮修复上线后不足以发现问题**——32 条真实 trace 全量重评实测仍有
6~7/32 裁判失败（且失败的具体是哪几条不稳定），此时才定位到 D2 的真实根因（见 Status 下方
2026-07-18 订正）。**这是本轮的关键教训**：单元测试用手写的 fixture 覆盖不到"模型真实输出会
怎样漂移"，只有对真实 provider 的重复调用才测得出。

2026-07-18 运行时验证（第二轮修复，删水位线 + `ONLINE_EVAL_BACKFILL_WINDOW_HOURS=-1` 全量
重评 32 条真实 trace，非 mock）：

- **裁判失败数 0/32**（此前 6~7/32），账本记账与 ClickHouse 完全对账（`scoresNotPersisted=0`）。
- 曾经失败的 10 条长答案（438~1290 字）**全部**拿到真实 faithfulness 分数（67~100 区间）。
- 免评门实测生效：19 条 fallback/零引用候选正确标为 `-1`（未评），真实答案的 faithfulness
  均分从**污染的 67**（11 条兜底空答案假 100 + 若干失败混杂）变为**可信的 85**
  （`sampleCount=12`，只由有实质内容的真答案构成）；答案相关性(38)/上下文精度(40) 同时
  如实偏低，不再被事实一致性的乱象掩盖。
- 离线路径用一次真实 `POST /eval/runs`（评测集 `1313`，应用「管理学答疑助手」）端到端验证：
  一条用例四指标全部真实评出（`faithfulness=94, correctness=67`），另一条因编排层超时被
  018 决策 C-3 的既有不变式正确判定 `unscored`（与本次裁判修复无关，是编排层的既有行为）。
- 单元测试 964 绿（含新增的归一化/修复重试/`MAX_ATTEMPTS=3` 用例）、`pnpm lint` 0、
  `pnpm build` 5/5、`test:db` 54 绿。

## References

- 017 在线答案质量评测
- 018 离线评测 run 与评测集，尤其 §12 缺口 10/22
- AGENTS.md 依赖边界与“设计文档权威”约定
