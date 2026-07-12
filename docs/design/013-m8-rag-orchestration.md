---
title: "问答 / RAG 编排内核（M8 OrchestrationService 与 SSE 流式）"
description: "七节点编排流水线、SSE 逐 token 流式、会话/消息持久化与完整 OTLP trace 写侧的架构设计。"
category: "design"
number: "013"
status: draft
services: [backend, contracts]
related: ["design/001", "design/002", "design/003", "design/004", "design/009", "design/011", "design/014"]
last_modified: "2026-07-12"
---

# 013 — 问答 / RAG 编排内核（M8 OrchestrationService 与 SSE 流式）

## Status

`draft` — 经 `/ship:arch-design`（完整对抗档：peer 独立调查 + diff + execution drill）完成。本文是 M8 里程碑（[002-implementation-roadmap](002-implementation-roadmap.md) L125）的落地设计：把 `chat.service.ts` 的 M2 桩替换为真实 RAG 编排。它消费而非重建 [011](011-prompt-assembly-node-contracts.md)（NodeRuntime typed output）、[008](008-retrieval.md)（RetrieverPort）、[009](009-m7-application-management.md)（production 指针与 resolvePublic）、[004](004-trace-observability.md)（OTel GenAI 语义约定）已建的地基。

对抗验证发现三处 P1（流式 span 生命周期、intent 路由喂料、多 KB 分数可比性）与四处 P2，均已在本文定稿。其中 **P1-② 需协调改 011 的 intent 契约**、**D6 的 gen_ai.usage.* 需改 models 域供应商 builder**、**检索 span 三拆需改 008 的检索 adapter**——三处跨模块边界的改动在 §11 集中登记。

trace 的**读侧** UI（列表 / 瀑布图 / Span 树 / 排查闭环）属 M9，本文只负责**写侧**产出契约。

## Summary

新增 `OrchestrationService`，以 `AsyncGenerator<ChatStreamEvent>` 串起七节点流水线（改写 → 意图 → embed → 多路检索 → 重排 → 生成 / 兜底），所有 LLM 节点只消费 NodeRuntime 的 typed output，检索复用 `RetrieverPort.retrieve()`。SSE 逐 token 回写复用现有 `POST /chat` 的 `text/event-stream` 通道，把 M2 的一次性数组升级为边跑边 flush。会话 / 消息是 **greenfield 持久化**（当前 `conversations.service` 是纯 mock、无写路径），本轮建表并写入 `message.trace_id`。编排全程产出一棵完整 OTLP span 树（`chain` 根 + 各阶段子 span），落 ClickHouse。C 端问答页 1:1 还原原型，本轮**仅 production 正式态**寻址。

## Boundaries

> 反漂移边界。任何实现越过以下范围，应先回来改本文。

**In-scope**

- `OrchestrationService`：`run(agentId, query, convId?)` 返回 `AsyncGenerator<ChatStreamEvent>`，串联七节点、判定正常 / 兜底、产出派生指标。
- `chain` 根 span 编排 + 各阶段子 span 显式挂父（跨 yield 不靠活动上下文）。
- SSE 事件契约（`token`/`citation`/`done`/`error`）与流式边界（首 token 超时熔断、断流、客户端 abort、超时后 SKIP）。
- `conversations` / `messages` 建表 + 写路径 + `message.trace_id` 写入。
- `confidence` / `coverage` / 兜底四原因的派生算法（011/009 未定义，本文定死）。
- production `resolvePublic` 接入 + 无 production 的"尚未上线"占位。
- trace 写侧属性：`chain` span kind、检索 span 三拆（embedding/rerank 子 span）、LLM `gen_ai.usage.*`、命中分表、质量信号、Session 状态聚合、落库 PII 脱敏。
- C 端问答页（三栏、消息流 + typing、行内角标 ⇄ 右栏原文、可信度 / 引用完整度、兜底卡、复制 / 反馈 / 转人工）。

**Out-of-scope**

- trace 读侧 UI（列表 / 瀑布图 / Span 树 / 详情 / 排查闭环）——属 M9。
- 版本 / 标识测试访问态（`/bot/<id>/v/<n>`、`/bot/<id>/<tag>`）+ 测试强制登录——延后（见 [[m8-scope-decisions]]）。
- `gen_ai.cost.cny` 计价——延后 M9，M8 只记 `gen_ai.usage.*` token。
- 匿名访问 + 限流——`/chat` 保持 JWT，不开匿名 SSE。
- 新增第 5 节点、语义级 Eval / LLM Judge。

**Invariants**

1. **非法节点输出绝不进入下游**（承 011 Invariant 1）：rewrite/intent 的结构化输出未过校验即修复或 fallback，编排不消费原始模型文本。
2. **编排根 span = `chain`**：LLM / 检索 / embedding / rerank 子 span 必须**显式挂父**到根 span，不依赖 async generator 的活动上下文。
3. **预览 = 运行时同路径**（承 011 Invariant 3）：resolveByTag 预演、resolvePublic 运行共用同一 `OrchestrationService`，靠 `rag.preview` 标记隔离统计。
4. **production 指针为空即"尚未上线"**：后端 `resolvePublic` 抛 404，SSE 控制器流前翻译为 HTTP 404，C 端渲染占位，不渲染会话 / 输入区。
5. **兜底 / 低分绝不编造**：检索最高分低于阈值或意图 unknown / 空路由时走 fallback 节点，不生成知识库外内容。

## Context（现状基线）

对抗调查确认的关键现状（file:line 为实证锚点）：

- `chat.service.ts` 是 M2 桩，返回一次性 `ChatStreamEvent[]`；`chat.controller.ts:28-37` 已是 `text/event-stream`（`data: ${json}\n\n`），客户端用 fetch + ReadableStream（带 Authorization）。M8 把 `generateStream` 改为 async generator。
- `NodeRuntimeService`（`node-runtime.service.ts`）已有 `executeStructured()` / `streamText()` / `compileAndSample()`，且**自带 LLM 子 span**（`withSpan` + `codecrush.span.kind=LLM`）。**但 `streamText()` 内部把 `text += chunk.delta` 消费完只返回整段 `{text}`（:305-333），不吐 token**；底层 `protocol-dispatch.adapter.ts` 读流循环（:195-214）**裸奔无超时**（60s timer 拿到响应头即 clearTimeout）。
- `RetrieverPort.retrieve(RetrievalTestRequest)`（`retriever.port.ts:6-8`）是**单 kbId**；`pg-hybrid-retriever.adapter.ts` 发**一个 RETRIEVAL span**（:42），embed/rerank 在内部无各自 span；rerank 成功时 `finalScore=rerankScore`（:116），失败降级时 `=融合分`（:182，加权线性和非 RRF）。
- `applications.service.ts:276-281` 的 `resolvePublic`：productionConfigVersionId 空时 **throw NotFoundException**；`buildResolvedConfig` 产出 `ResolvedApplicationConfig`（`applications.ts:224`），含四节点 promptBody/contractVersion/modelId/temperature、kbIds、`retrieval`（含 rerankModelId/rerankThreshold），**但不带向量相似度 threshold、也不带 embeddingModelId**（后者在 KB 表、同应用共享）。
- `db/schema.ts` **无 conversations/messages 表**；`conversations.service.ts` 是纯内存 mock、无 create/append。
- ClickHouse 走 `otel_traces` + 防腐 VIEW `codecrush_trace_spans`，`attributes` 是**开放 Map**、`status_code`/`kind` 自由字符串 → M8 新属性**零 schema 迁移**。
- `otel-conventions/index.ts:50-59` 的 `CODECRUSH_SPAN_KIND` 无 `CHAIN`；`ChatResult.usage` / `ChatStreamChunk.usage` 类型存在但**供应商 builder 从不产出**。

## Goals / Non-goals

**Goals**

- 一句问题产出带引用的回答，非法节点输出可观测并降级，ClickHouse 出现完整 span 树，`message.trace_id` 写入（M8 验收标准）。
- 复用地基不重建：LLM 执行走 NodeRuntime，检索走 RetrieverPort，span 走 `@codecrush/otel`。
- C 端问答页按原型 1:1 还原（用户拍板 2026-07-12：先读原型对应屏再还原）。

**Non-goals**

- 不追求答案语义正确（留 M11 Eval）；本文只保证结构、引用、降级、可观测。
- 不做 trace 读侧、不做测试访问态、不做 cost 计价。

## Design

### §1 组件与数据流

```
POST /chat (SSE, JWT)                          packages/contracts: ChatRequest/ChatStreamEvent
  └─ ChatController: text/event-stream, fetch+ReadableStream
      └─ OrchestrationService.run(agentId, query, convId?)  → AsyncGenerator<ChatStreamEvent>
          │  applications.resolvePublic(agentId)  → ResolvedApplicationConfig | throw 404 → HTTP 404(占位)
          │  [chain 根 span: rag.pipeline  ── §4 手动 span，跨 yield 保持打开]
          ├─ 1. rewrite   NodeRuntime.executeStructured → {rewrittenQuery, keywords}      (子 span llm)
          ├─ 2. intent    executeStructured → {intent, routeIds⊆kbIds, confidence}        (子 span llm) §2
          ├─ 3~4. retrieve  按 routeIds→kbIds 逐个 RetrieverPort.retrieve()               (子 span retrieval
          │        (rerank 折在 retrieve 内)                                                 └ embedding/rerank 子 span §5)
          ├─ 5. 合并去重 + 组装 citations + retrievalContext + 判定 正常/兜底  §6/§7
          ├─ 6a 正常 → reply    NodeRuntime.streamTextChunks(新增) → yield token…          (子 span llm) §1-D1
          │   6b 兜底 → fallback streamText(整段) + 兜底四原因                             (子 span llm)
          ├─ 7. 派生 confidence/coverage → yield done{traceId,confidence,coverage,isFallback,fallbackReasons}
          └─ 落库: conversations(按 agentId 隔离) + messages(user/assistant, trace_id, conf, coverage, isFallback) §9
```

要点：NodeRuntime 的 execute/stream 方法**已发 LLM 子 span**，编排只建 `chain` 根；检索 adapter 发 retrieval span（本轮内拆 embedding/rerank）。所有子 span 通过 §4 的原语**显式挂父**。

### §2 节点流水线与短路

| # | 节点 | 方法 | 输入 → 输出 | 短路 / 降级 |
|---|------|------|-------------|-------------|
| 1 | rewrite | executeStructured | {query,history} → {rewrittenQuery,keywords} | 校验失败 → fallback：rewrittenQuery=原 query |
| 2 | intent | executeStructured | {rewrittenQuery,history} + reserved{**availableRoutes**} → {intent,routeIds,confidence} | fallback：{unknown,[],0} → 触发兜底或全 KB 召回 |
| 3-4 | retrieve(+rerank) | RetrieverPort.retrieve × N KB | rewrittenQuery → RetrievalHit[] | 见 §7；命中为空 → 兜底 |
| 5 | 组装 | 编排纯逻辑 | hits → citations + retrievalContext | top<阈值 或 intent unknown/空 → 走兜底分支 |
| 6a | reply | **streamTextChunks** | {query,history,retrievalContext} + reserved{citations} → token 流 | 首 token 超时 / 断流 → §3 边界 |
| 6b | fallback | streamText | {query} → 整段兜底话术 | 空正文 → 平台固定文案 |

~~**intent 真路由（P1-②，改 011）**：`availableRoutes` 从 `string[]`（裸 kbId UUID，模型无法映射中文问题）升级为 `{id,name,desc}[]`，intent 契约升 v2，`extraValidate` 仍强制 `routeIds ⊆ availableRoutes.id`。编排把 routeIds 当 kbId 逐个 retrieve。~~
> **本段已被 [014-intent-routing](014-intent-routing.md) 取代（2026-07-12）**：intent 不再输出 KB id/routeIds——模型只做静态闭集大分类（enum），路由靠「KB 外挂大分类」配置映射（`knowledge_bases.intent_key`）；CHAT 为一等意图直走兜底不检索；UNKNOWN/降级 → 全 KB 召回（「不过窄」原则保留）。上表第 2 行（intent）与第 3 行（retrieve 的 routeIds 语义）以 014 §D3/§D4 为准。

### §3 SSE 事件契约与边界

保持现有 `ChatStreamEventSchema`（`chat.ts:40-46`）：`token{delta}` / `citation{citation}` / `done{traceId,confidence?,...}` / `error{message}`——**不加 stage**（C 端原型只有 typing 三点动画、无阶段标签；实时阶段进度属 trace/M9）。

**扩 `done` 事件**：加 `coverage`、`isFallback`、`fallbackReasons`（客户端 done 后立即渲染页脚）。`traceId` 必填（`min(1)`），fallback / error 路径也必须给合法 traceId（根 span 起始即可得）。

**边界处理**：

- **首 token 超时**：streamTextChunks 内计时，超 `FIRST_TOKEN_TIMEOUT_MS`（常量，待压测）→ 熔断 → `error` 事件 + span `status_code=ERROR`。
- **已发 token 后断流**：不可撤回已产出内容 → 照常 `done`，带已产出文本；span `status_code=WARN`。
- **客户端 abort（res close）**：向上游 `reader.cancel()`（`protocol-dispatch.adapter.ts:217-222` 已支持）→ span `status_code=WARN` → §9 落部分内容 + aborted 标记。
- 传输机制沿用 M2：`res.write(\`data: ${JSON.stringify(event)}\\n\\n\`)`，每事件 flush。

### §4 流式 span 生命周期原语（P1-①）

`withSpan`（`trace.ts:41-53`）在回调 resolve 瞬间 `span.end()`，**承载不了"边 yield 边保持打开"的根 / reply span**；且跨 async generator 的 yield 边界，ALS 活动上下文不保证回到 span 创建时的 context。

→ `@codecrush/otel` **新增 generator 友好原语**（手动生命周期）：

```
startManualSpan(name, attrs, parent?) → { span, ctx }   // tracer.startSpan + trace.setSpan(context, span)
runChild(parentCtx, name, attrs, fn)                     // context.with(parentCtx, () => withSpan-like，显式挂父
```

写死约束：**跨 yield 不靠活动上下文，子 span 一律显式挂父**（把父 span 的 context 传给每个子阶段）；根 span 在 generator 主体末尾 `finally` 手动 `end()`。否则 naive 实现会让 reply span 脱链或根 span 提前 end。

### §5 span 树与 trace 写侧属性

- 补 `CODECRUSH_SPAN_KIND.CHAIN`（otel-conventions），根 span `rag.pipeline` 用之。
- **检索 span 三拆**（遵产品设计，让瀑布图看各段效果，改 008 adapter）：`retrieval` 父 span 内，给 embed 调用包 `embedding` 子 span、给 rerank 调用包 `rerank` 子 span。命中分表沿用 `rag.chunk.scores`（每分块向量 / 关键词 / rerank 分）。
- **LLM `gen_ai.usage.*`（P2，跨三层）**：非"span 补记"——供应商 builder 层根本没取数。需 openai 加 `stream_options:{include_usage:true}` 解析末帧、anthropic 解 `message_delta.usage`（+`message_start` 输入 token）、gemini 解 `usageMetadata`，adapter 透传 usage，node-runtime 累计后 `span.setAttribute(GEN_AI.USAGE_INPUT_TOKENS/OUTPUT_TOKENS)`。
- **status WARN/SKIP**：走 `status_code` 字符串（读模型 `statusCode: z.string()` 不限枚举；OTel SpanStatus 只有 OK/ERROR/UNSET，表达不了 WARN/SKIP）。超时熔断后被跳过的下游节点标 `SKIP`、灰显。
- **质量信号自动判定**（新增，b-trace PRD）：低召回分（top<阈值）/ 无引用（citations 空）/ 生成拒答（fallback）/ 超时——写为 span 属性，供 M9 汇入 Badcase 池。
- **Session 状态聚合**：任一轮失败即"含失败"、有兜底即"含兜底"、否则"正常"——写侧记录每 message 的状态，M9 读侧聚合。
- **落库 PII 脱敏**：输入 / 输出敏感字段落 ClickHouse 前处理（b-trace PRD"已脱敏"标记）。

### §6 派生指标算法（011/009 未定义，本文定死）

- **兜底触发** = `top finalScore < FALLBACK_THRESHOLD` 或 intent=unknown / 空 routeIds 且全 KB 召回仍空。`FALLBACK_THRESHOLD` 为平台常量（默认取原型 rtThreshold=0.20）；rerank 开启时改用 `rerankThreshold`。检索本身 `retrieve()` 传 `threshold=0`（topK 内全召回，阈值判定在编排层）。
- **confidence（0-1，三级）**：取被引用分块 finalScore 的代表值（默认 top 命中分）。≥0.85 高 / 0.70–0.85 中 / <0.70 低（+黄色告警条）。**可信条件约束见 §7**。
- **coverage（full/partial）**：full 当 reply 文中所有 `[n]` 角标合法（∈ citations）、引用 ≥1、且非兜底；否则 partial。不做 NLP 语义判断，纯基于角标合法性 + 数量的可计算规则。
- **兜底四原因**（b-trace/c-product PRD）：超出范围（intent=unknown）/ 相似度过低（回填真值 top X < thr Y）/ 检索范围（routeId → KB 名列表）/ 已处理（按兜底话术，未编造）。

### §7 多 KB 检索合并与可比性（P1-③）

`retrieve()` 是单 KB 粒度，编排按 routeIds 逐个调用后合并去重（by chunkId），按 finalScore 全局排序编 `[n]` 角标。

**已知偏差**（对抗发现）：rerank 成功时 `finalScore=rerankScore`、失败降级时 `=融合分`（两种量纲）；BM25 `kwScore` 是语料相对。跨 KB 合并、且部分 KB rerank 成功部分降级时，全局排序与 confidence 存在标定偏差。

**决策**：记录该偏差；**约束 conf 可信条件——仅当本次检索的所有 KB 走同一路径（全 rerank 或全不 rerank）时 confidence 完全可信**，否则 done 事件仍给出 conf 但 M9 侧据质量信号提示。绑定 KB 共享单一 embedding 模型（staticGate 保证），故 `vecScore` 同空间可比。**Revisit**：未来 `RetrieverPort` 增加"合并池单次 rerank"能力消除偏差。

### §8 production 访问解析

C 端 `resolvePublic(agentId)`（`applications.service.ts:276-281`）→ productionConfigVersionId 空时 **throw NotFoundException**，SSE 控制器流开始前捕获、翻译为 **HTTP 404**（带 `reason: not_published`），C 端据此渲染"尚未上线"占位（弱化头像 + 去管理台按钮），不渲染会话与输入区。非空 → `ResolvedApplicationConfig(preview=false)`。

**`agentId` 语义 = applicationId / slug**（防解错域：`applications.ts` 明示 agents 是待下线旧域；`ChatRequest.agentId` / `Conversation.agentId` 沿用旧名，编排解析的是 application）。版本 / 标识测试态 + 测试登录延后。

### §9 会话 / 消息持久化（greenfield）

新建 drizzle 表（当前完全不存在）：

- `conversations`：id / agentId / userId? / title / updatedAt，**按 agentId 隔离**。
- `messages`：id / convId / role(user|assistant) / content / traceId / confidence / **coverage** / **isFallback** / **fallbackInfo** / citations。

**扩 `Message` 契约**（`conversations.ts`）加 coverage / isFallback / fallbackInfo。

**写路径时序**：user message 流开始前落库；trace_id 在 chain span 起始即可得；assistant message 的 conf/coverage/isFallback **只有流跑完才知 → 流末落库**。**中途 error / abort**：落**部分** assistant 内容 + 标记 `aborted` 状态（已有 trace_id，保证 trace ⇄ 消息可对齐）。

### §10 接线契约映射（P2）

- **字段名映射**：`ResolvedApplicationConfig.retrieval` 用 `vectorWeight / hybridEnabled / rerankEnabled / rerankModelId`，`RetrievalTestRequest` 用 `vecWeight / multi / rerankModelId(存在与否)`——编排做转换；`rerankEnabled=false` 时不传 `rerankModelId`。
- **embedModelId** 取自 KB 表（resolved config 不带；同应用 KB 共享一个，取任一绑定 KB 的 `embeddingModelId`）。
- **threshold** 恒传 0（§6）。

### §11 跨模块边界依赖（协调点）

M8 编排内核需以下三处**跨界改动**，实现拆 story 时须协调，触碰信任面的单独审：

1. **011 / node-runtime**：intent 契约改动**以 [014](014-intent-routing.md) 为准**（reserved `availableRoutes`→`availableIntents` 全表注入、output 改 enum 静态闭集去 routeIds、就地 v1）；新增 `streamTextChunks()`；新增 span 生命周期原语（§4）；LLM span 补 `gen_ai.usage.*`。
2. **models 域**：三协议 builder + adapter 产出 usage（§5）。
3. **008 / 检索**：adapter 内拆 embedding / rerank 子 span（§5）。

## Trade-offs

| 决策 | 选择 | 放弃 | 理由 |
|------|------|------|------|
| 检索相似度阈值 | 平台默认常量 + retrieve threshold=0 | 配置字段（按应用可调） | 不动 M7 已建 config schema / 版本迁移 / 发布门禁 |
| 检索 span 粒度 | 拆 embedding/retriever/reranker 三 span | 单 retrieval span | 产品设计要求瀑布图看各段效果；可观测优先 |
| cost | M8 只记 token，cost.cny 延后 M9 | 现在算 cost | 无定价源，不在编排内核引入 models 域定价决策 |
| intent 路由 | ~~真路由（改 011 intent v2）~~ → **意图表 + KB 外挂绑定（见 014）** | 模型直选 KB id | 裸 UUID 路由极脆；014 改为静态闭集分类 + 配置映射 |
| SSE 事件 | token/citation/done/error（不加 stage） | 实时阶段进度流 | C 端原型只有 typing；阶段进度属 trace/M9 |
| C 端鉴权 | 保持 JWT | 匿名 @Public + 限流 | 避免无鉴权 LLM+检索的成本 / DoS 面 |

## Assumptions

- 绑定 KB 共享单一 embedding 模型（staticGate `KB_EMBEDDING_MISMATCH` 门禁保证）。
- OTLP → ClickHouse 链路 M0.5 已通（`emitManualHelloSpan` 往返验证）。
- node-runtime `executeStructured` / `streamText` 契约稳定；本文只**新增** `streamTextChunks`，不改现有签名。
- ClickHouse span `attributes` 是开放 Map、`status_code` / `kind` 自由字符串 → trace 新属性零 schema 迁移。

## Revisit triggers

- 检索相似度阈值将来可下沉为配置字段（当前常量 → 应用可调）。
- conf / coverage 是首版启发式，接入 M11 Eval 后按真实命中率 / 引用正确率重校。
- `streamTextChunks` 的首 token 超时常量 `FIRST_TOKEN_TIMEOUT_MS` 待压测调。
- `RetrieverPort` 增加"合并池单次 rerank"以消除多 KB finalScore 标定偏差（§7）。
- 遥测关闭时（无 OTLP endpoint 走 NoopTracer）traceId 为全零串，`done.traceId` 深链会指向不存在的 trace → 死链，需兜底（省略深链 / 合成 id / done 标 telemetry 状态）。
- C 端匿名访问 + 限流（当前保持 JWT）。

## References

- 里程碑与验收：`002-implementation-roadmap`（M8 行）
- NodeRuntime 执行 / 契约：`011-prompt-assembly-node-contracts`
- 检索端口与融合：`008-retrieval`
- 应用管理与 resolvePublic：`009-m7-application-management`
- 可观测语义约定：`004-trace-observability`
- 产品设计输入：`docs/prd/c-product.pdf`（C 端问答页）、`docs/prd/b-trace.pdf`（trace 写侧产出契约）
- 原型（权威，前端 1:1 还原）：`RAG知识库问答系统设计/CodeCrushBot.dc.html`
