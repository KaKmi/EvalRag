---
title: "轻量级 Trace 可观测（自研 Langfuse 式）"
description: "自研轻量 Langfuse：Session>Trace>Observation 模型、OTLP 结束即写、大 payload offload、首期以 VIEW 读模型跑通功能，后续按需演进物化层；本版聚焦 RAG 节点。"
category: "design"
number: "004"
status: draft
services: [backend, frontend, observability]
related: ["design/001", "design/003"]
last_modified: "2026-07-05"
---

# 004 — 轻量级 Trace 可观测（自研 Langfuse 式）

## Status

`draft` — 观测子系统设计。**自研**一个轻量 Langfuse（不使用 Langfuse 本身），细化 `001` 的可观测章节。本版聚焦 **RAG 节点**；agent/tools 留口不落地。落地随 M0.5/M9 推进后对照代码升 `current`。

## Summary

借 Langfuse 的**数据模型与存储分层**，砍掉其重型基建。核心：**Session → Trace → Observation** 三层；**用 OTLP「span 结束即写」**取代 Langfuse 的 Redis 队列 + ReplacingMergeTree 流式 upsert（这就是"轻量"的由来）；**大 payload 与媒体在 emission 时 offload 到对象存储、只留引用**，ClickHouse 里保留可查结构与指标。首期（M0.5/M9）读侧只对 `otel_traces` 做 **VIEW 投影**（observations/traces/sessions），不落第二套写链路、不引入 trace worker；等指标/评测/反馈变复杂，再把 VIEW 演进为物化表或 normalizer worker。UI 两级：会话气泡流 + Trace 详情（瀑布 + span 树 + RAG 面板）。**本版一等公民是 RAG 节点**（改写→意图→召回→重排→生成）。

## M0.5 落地取舍

本项目是内部服务 / 面试向 side project，首期目标是**功能闭环优先**，不是复刻 Langfuse 的完整摄取平台。因此 M0.5 明确只做：

```
Backend OTel SDK → Collector → ClickHouse otel_traces → 自有 VIEW → traces API
```

暂不做：
- 自建 ingestion API。
- Redis / Valkey 队列。
- trace-normalizer worker。
- 独立 `traces` / `observations` / `sessions` 物化写表。
- 进行中 trace 的流式 upsert。

这个取舍不改变对外语义：**OTLP 是标准入口，Session/Trace/Observation 是产品读模型**。区别只是首期读模型由 VIEW 从 raw OTLP 投影出来，而不是由 worker 写入专用分析表。

## Boundaries

> 反漂移边界。改模型/边界先改本文。

**In-scope（本版 / 轻量）**
- Session/Trace/Observation 模型（承载于 OTLP）。
- **RAG 管线节点埋点**：改写 / 意图 / 生成 = Generation；多路召回（向量+关键词）/ 重排 = 检索类 Span；命中 = event/span。
- **结束即写**（span 在阶段完成时 emit，一次写入）。
- 大 payload / 长文本在 emission 时 offload 到对象存储（存 `*_ref`）；`media_id` 字段**预留但不实装上传**（本版无图片输入）。
- VIEW 读模型（observations/traces/sessions）+ 只读 API。
- 两级 UI：会话视图 + Trace 详情（瀑布/span 树 + 命中分块/引用面板）。
- 每 Trace / 每 Session 的 token & cost 汇总。

**Out-of-scope（本版不做）**
- **agent / tools 埋点**：SDK 原语设计上支持（`trace.tool/agent`），本版不落、不测（future）。
- Redis 队列 / 流式 upsert / 看"进行中"的 trace（结束即写的代价：trace 于一轮完成后~2-3s 才出现）。
- Langfuse 式 trace-normalizer worker、ReplacingMergeTree upsert、独立分析事实表（`traces` / `observations` / `scores`）的首期落地。
- 评测集 / 实验 / playground / 内置 LLM-as-judge（归 M11 评测）。
- 多项目/组织 / RBAC / 公开分享链接 / 告警 / 复杂看板。
- Prompt 管理（已有独立模块）。
- 图片/媒体上传与渲染 UI（仅预留 `media_id`）。

**Invariants**
1. **Trace = 一轮**：RAG 一次问答（改写→…→生成）= 一个 trace；（未来）一个 agent run（含整个循环）= 一个 trace。同一轮所有节点共享一个 `trace_id`。
2. **Session 只是 `session_id` 分组键**，不是存储容器；会话视图 = 查 `WHERE session_id=X` 拼出。
3. **结束即写、埋点绝不进入问答关键路径**：观测组件故障不得导致问答失败或增加用户可感延迟。
4. **大 payload / 媒体绝不内联 ClickHouse**：对象存储 + 引用 id。
5. **应用只吐 OTLP**；`otel_traces` 由 Collector 导出器建，读侧只经自有 VIEW（防腐）。
6. **SDK 工作负载通用**（llm/embeddings/retrieval，[tool/agent 留口]）；**RAG 节点是首个也是本版唯一消费方**。
7. **通用包不包含物理层**：`@codecrush/otel*` 只管 trace 语义与 OTLP 发射；ClickHouse 表、VIEW、Trace API 属于 `infra/` 与 `apps/backend/modules/traces`。

## 数据模型：Session → Trace → Observation

- **Session（会话）** = 多轮；仅 `session_id`。
- **Trace（一次来回）** = 一轮问答；`input`=用户问题，`output`=最终答复。**RAG 整条管线在这一个 trace 内。**
- **Observation（观测项）**，三型：
  - **Generation** — LLM 调用（改写/意图/生成）：`input`=messages，`output`=回答，`usage`=tokens，`cost`，`model`。
  - **Span** — 有时长的工作单元（多路召回、重排、命中）。
  - **Event** — 时间点事件。
  - 经 `parent_span_id` 组成树，Trace 是根。

### 本版 RAG 节点 → Observation / OTLP 映射

| RAG 节点 | Observation | `gen_ai.operation.name` | 关键属性 |
|---|---|---|---|
| 问题改写 | Generation | `chat`（低温模型）| model, tokens, cost |
| 意图识别 | Generation | `chat` | model, tokens, cost |
| 多路召回（父）| Span | 自定义 `retrieve` | `rag.retrieval.top_k`, `rag.multi`, `rag.threshold` |
| ├ 向量召回 | Span | `embeddings` + 向量检索 | embed model, 维度 |
| └ 关键词召回 | Span | 自定义 `keyword_recall` | — |
| 重排 | Span | 自定义 `rerank` | rerank model, top_n |
| 命中知识 | Span/Event | 自定义 `hits` | `rag.chunk.scores`（向量/关键词/rerank 分）, `rag.citation.ids`（角标↔分块）|
| 大模型生成 | Generation | `chat` | gen model, tokens, cost, `rag.prompt.version_id` |

> 命中分块/引用等结构化明细用 span events + **只存 chunk_id 引用**，正文回 Postgres 取（呼应 001/003）。属性 key 常量在 `@codecrush/otel-conventions`。

### Agent / RAG 端发送形态

Agent 或 RAG 编排端**不发送三层嵌套 JSON**，而是通过 `@codecrush/otel` 发一组标准 OTLP spans。三层模型由 `trace_id` / `span_id` / `parent_span_id` / `session_id` 在读侧还原：

```
OTLP spans:
  trace_id=t1, span_id=root, parent=null,    name=chat.turn, session_id=s1
  trace_id=t1, span_id=r1,   parent=root,    name=retrieve
  trace_id=t1, span_id=g1,   parent=root,    name=llm.generate

读侧模型:
  Session s1
    Trace t1
      Observation root
        Observation r1
        Observation g1
```

这回答了“Langfuse 是三层模型，传输是不是三层”的区别：三层是产品/分析模型；传输可以是 OTLP span 批次，也可以是 Langfuse SDK events。我们首期选择 OTLP span 批次作为唯一标准入口。

## 存储与读模型

**为何"轻量"**：OTLP span **结束即写**（一次写入），天然绕开 Langfuse 的流式 upsert（Redis 队列 + ReplacingMergeTree）。代价：看不到"进行中"的 trace，一轮完成后~2-3s 出现——本版可接受。

**offload-at-emission**：大字段/媒体在建 span 前就传对象存储（MinIO→OSS），span 里只放 `input_ref`/`output_ref`/`media_id`。→ span 精简，OTLP→Collector→ClickHouse 用**通用 exporter**即可，无需自建摄取服务；CH 行不膨胀。

**读侧全是对 `otel_traces` 的 VIEW 投影**（M0.5/M9 不落第二套表）：
```
observations  ← 每 span 一行：trace_id, span_id, parent_span_id, session_id,
                type(span|generation|event), name, start, duration, status,
                model, input_tokens, output_tokens, cost_usd,
                input_ref/output_ref(对象存储 key), media_id(预留), attrs
traces        ← 按 root span 聚合：trace_id, session_id, user_input, output,
                total_duration, total_tokens, total_cost, status
sessions      ← 按 session_id 聚合：trace_count, first/last_ts, total_cost, total_tokens
```
读 API：Trace 列表（筛选 会话/Agent/状态/耗时/cost）、Trace 详情（observation 树）、Session 会话视图、cost/token 汇总。Postgres 侧 `message.trace_id` / `session_id` 建索引，从回答一键跳 trace。

### 包与物理层边界

```
业务编排(chat/retrieval/未来 agent)
  └─ @codecrush/otel              # 通用 Node SDK：withSpan / trace.llm / trace.retrieve
       └─ OTLP spans
            └─ Collector
                 └─ ClickHouse otel_traces
                      └─ infra/clickhouse VIEW
                           └─ backend traces module
                                └─ contracts Trace DTO
                                     └─ frontend Trace UI
```

- `@codecrush/otel-conventions`：纯常量/枚举/类型，前端、后端、VIEW 设计共同使用。
- `@codecrush/otel`：仅后端运行时，负责 OTel SDK 初始化、span 原语、脱敏钩子和 OTLP exporter 配置。
- `infra/clickhouse`：物理存储投影，拥有 VIEW SQL。
- `apps/backend/modules/traces`：只读查询与 Session/Trace/Observation API，负责把 ClickHouse 行拼成产品模型。

因此 trace 能力“通用”的边界到**语义与发射层**为止；物理层保持在应用/infra 内，避免通用 SDK 绑定 ClickHouse 或当前 VIEW schema。

### 演进路径

若后续指标查询、评测或反馈能力超出 VIEW 的舒适区，按复杂度逐步演进，而不是一次到位：

1. **VIEW 投影**（首期）：最少组件，满足 trace 列表/详情、span 树、耗时/token/cost 基础汇总。
2. **ClickHouse Materialized View**：把常用投影固化为 `observations` / `traces` 宽表，提升筛选和聚合性能。
3. **trace-normalizer worker**：当需要复杂 score、反馈补写、对象存储 payload 合并、重算/回放、进行中 trace 时，引入类似 Langfuse Worker 的异步加工层。

演进时仍保留 `otel_traces` raw 层，保证可回放、可校验、可迁移。

## UI：两级视图

**① 会话视图（Session）** — 聊天记录，**一轮一个气泡**（user 问题 → assistant 最终答复）。看不到管线细节，干净来回。点某轮 → 进详情。

**② Trace 详情** — 展开这一轮：
- **顶部 turn 级汇总**：总耗时、总 tokens、总 cost、模型调用次数、状态。
- **调用瀑布图**：每个 generation/span 一根时间条，RAG 管线顺序（改写→意图→召回→重排→生成）一眼看清耗时流。
- **Span 树**：按 `parent_span_id` 缩进（召回下挂 向量/关键词）。
- **点节点 → 右侧面板（按 span kind 数据驱动）**：
  - 检索类 span → **命中分块面板**（向量分/关键词分/rerank 分、引用来源 角标↔分块）。
  - Generation → prompt/messages、tokens、cost、model、可跳 Prompt 版本。
- **未来 agent/tools**：同一套树里多出 `tool`/`invoke_agent` 节点，面板换成 args→result；免新框架。

## Failure modes

- Collector/ClickHouse 挂：SDK BatchSpanProcessor 有界队列 + Collector 磁盘持久队列；满则丢 span，**问答照常**（Invariant 3）。
- 对象存储挂：offload 失败 → 降级为截断存 CH（带 `truncated` 标记），不阻断问答。
- span 过大（未 offload 的漏网大属性）：Collector attributes processor 兜底截断。

## Alternatives considered

| 决策 | 选择 | 拒绝 | 取舍 |
|---|---|---|---|
| 是否用 Langfuse | 自研轻量 | 直接用 Langfuse | 少一个重服务/自主可控；放弃其现成 UI/生态 |
| 摄取方式 | OTLP 结束即写 | Langfuse 式流式 upsert(Redis+ReplacingMergeTree) | 简单无队列；放弃"看进行中 trace" |
| 读模型 | `otel_traces` + 自有 VIEW 投影 Session/Trace/Obs | 首期自建 traces/observations 写表 | 最少写链路、纯 OTLP；投影逻辑集中在 VIEW，够用再演进到物化表/worker |
| 大 payload/媒体 | emission 时 offload 到对象存储，存引用 | 内联进 CH span 属性 | span 精简、行不膨胀；多一次对象存储写 |
| agent/tools | 本版留口不落 | 本版就做 | 聚焦 RAG（产品本版无 tools）；SDK 通用保证零改造接入 |

## Assumptions

1. 本版**无 agent/tools、无图片输入**：RAG 管线节点为唯一埋点消费方；`media_id` 预留不实装（媒体选项 A）。
2. 规模 ≤10 qps（001）：结束即写 + 单 Collector + 单 ClickHouse 足够。
3. 对象存储先 MinIO（本地），后 OSS；`BlobStore` 端口复用 003。
4. Trace ~2-3s 延迟出现可接受（无"进行中"实时视图）。

## Revisit triggers

- 需要"进行中"实时 trace / 高频 upsert → 引入队列 + ReplacingMergeTree（走向 Langfuse 式）。
- VIEW 投影变复杂或性能不足 → 落独立 `traces`/`observations` 物化表。
- 上 agent/tools → 启用 SDK 的 `trace.tool/agent` 原语 + UI 面板（数据模型不变）。
- 出现图片/多模态输入 → 实装 `media_id` 上传与渲染。

## References

- 系统架构与可观测：`001-rag-platform-architecture`
- 代码组织与通用 Telemetry SDK / 包边界：`003-code-organization`
- 路线图（M0.5 可观测闭环 / M9 Trace 追踪）：`002-implementation-roadmap`
- 参考模型：Langfuse（Session/Trace/Observation、v3 CH+Postgres+对象存储分层、OTLP 摄取）
