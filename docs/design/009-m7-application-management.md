---
title: "M7 应用管理与配置发布"
description: "应用发布：production 单指针（受门禁 CAS）+ 版本命名标签访问锚点 + 异步真实 NodeRuntime ReleaseCheck。"
category: "design"
number: "009"
status: not-implemented
services: [backend, frontend, contracts, chat, node-runtime]
related: ["design/001", "design/002", "design/003", "design/008", "design/011", "design/012"]
last_modified: "2026-07-12"
---

# 009 — M7 应用管理与配置发布

## Status

`not-implemented`。2026-07-11 根据最新版 `RAG知识库问答系统设计/CodeCrushBot.dc.html`、聚焦原型 `RAG知识库问答系统设计/应用详情·Playground.dc.html`、011 NodeContract 执行引擎和 012 Prompt 管理重构完成架构设计；2026-07-12 M7b arch-design 定稿**应用版本命名标签 + 发布闭环**并回改本正文，消除此前"正文=单指针 / 附节=标签模型"的自相矛盾。

**最终采用混合模型 B+**：`applications.production_config_version_id` 单指针**保留**为线上事实的权威列（CAS 目标、ReleaseCheck 落点、公开默认解析、"是否上线"布尔）；**新增** `application_config_version_tags` 表**只存自定义命名锚点**（如 `qa20260707`），作为版本稳定可读的访问引用（等价 git tag）；`production` 是标签命名空间的保留字但**物理上不入表**，只活在指针里。上线门禁仍拆为静态检查 + 异步真实 NodeRuntime 预演。该结论经完整对抗档（host 设计 + peer 独立调查双盲一致 + execution drill）产出，为什么不把 production 也做成标签行见 §Alternatives。

M7a 已交付应用身份、不可变配置版本与单指针地基（`apps/backend/src/modules/applications/`）。本文 M7b 部分——命名标签表、异步真实 ReleaseCheck、CAS 上线/回滚、`resolveByTag`、停用/恢复/软删——尚未实现，故保持 `not-implemented`。当前发布相关代码仍是旧 M7：`apps/backend/src/modules/agents/`、`agents.current_version_id`、`agent_config_versions.status/eval_*`、v1 自动发布和 Eval stub，作为迁移输入。旧 `008-m7-agent-management.md` 曾记录该实现；因其与 M5 的 008 编号冲突，目标设计规范化为 009，迁移历史保留在本文。

## 开放问题决策（2026-07-12 定稿）

M7b arch-design 闭合了此前四个待澄清项：

| 问题 | 决策 | 理由 |
|---|---|---|
| 带标签公开 URL 可见性 | **非 production 标签仅管理员可达**（用户 2026-07-12 拍板） | 自定义标签未过发布门禁，可能指向 ReleaseCheck 失败/从未检查的版本；放匿名直达 = 绕过发布安全门，违反"公众只见受门禁配置"。单管理员模型下 QA/分享=管理员持链接。要公开非 prod 版本属"发布 channel"特性（见 Revisit）。 |
| 自定义标签数量上限 | **每应用 20 个软上限**，超限 422 | 应用锚点随时间堆积（qa20260707/qa20260814…），不同于 012「1-3 标签/版本」；20 足够 QA/分享，防泛滥与「标识」列 UI 退化 |
| `production` 之外是否保留 `beta` | **不保留**，唯一保留字是 `production`（+ `v`） | production 特殊仅因其受门禁生命周期；beta 无门禁语义=普通锚点；保留 beta 会暗示不存在的第二特殊通道。多环境路由仍 out-of-scope |
| 「管理标识」入口 | **共用一个弹窗入口，分两套后端流程 + 两套二次确认** | 对齐原型；production 行走受门禁上线流程，自定义行即时移动/摘除；弹窗按保留字派发，绝不把 production 走自定义端点 |

## Summary

应用是一份完整 RAG 运行配置：知识库集合、四个固定节点各自引用的 PromptVersion、模型和生成参数，以及检索、重排和兜底策略。编辑态只存在于前端；点击“保存为新版本”追加不可变 ApplicationConfigVersion；点击“上线这个版本”先创建异步 ReleaseCheck，检查通过后再以乐观并发（CAS）方式原子移动 `production_config_version_id`。

发布线上事实由单一 `production_config_version_id` 指针承载，上线/回滚/下线都是对它的受门禁 CAS 操作。在指针之外，应用配置版本可以打**自定义命名标签**（存于独立的 `application_config_version_tags` 表）作为稳定可读的访问锚点——移动自定义标签即时生效、无门禁，仅供管理员经 `resolveByTag` 访问。`production` 是标签命名空间的保留字，不作为标签行存在。

Prompt 标签与应用发布完全解耦。Prompt 的 `production` 仅是 Prompt 域内的高亮管理标识，移动它不会改变任何应用（012）。应用的自定义标签复用 012 的排他移动 + 复合 FK 归属**范式**，但归属 applications 域、与 Prompt 标签零耦合。应用版本始终固定引用具体 PromptVersion；PromptVersion 固定 ContractVersion。匿名公开问答只读取应用 production 指针；管理员对话测试与带标签解析可显式选择任意已保存版本。

## Boundaries

### In-scope

- 应用列表、详情、新建、基础信息编辑、停用/恢复、下线和删除。
- 前端临时编辑态、保存不可变应用配置版本、版本历史和载入编辑。
- 版本级知识库集合、四节点 PromptVersion/模型/生成参数、检索与兜底快照。
- 单一 `production_config_version_id` 的上线、回滚和下线语义（受门禁 CAS）。
- 应用版本命名标签：`application_config_version_tags` 表、排他移动、复合 FK 归属、20 个/应用软上限、`resolveByTag` 管理员解析、版本历史「管理标识」弹窗。
- 上线前静态检查 + 异步真实 NodeRuntime 预演，结果以短期 ReleaseCheck artifact 保存。
- 应用版本对话测试；Prompt 失败问题跳转到 Prompt 试运行并带入应用上下文。
- applications 域提供 Prompt 页面“谁在用”的只读派生查询。
- 从旧 agents 三态/Eval stub 模型迁移；`deleteApplication` 由硬删改软删（`deleted_at`）。

### Out-of-scope

- 应用级**多环境路由**：`staging` 环境别名、灰度权重、按环境分流——命名访问锚点标签**已移入 in-scope**，但它只是版本引用，不承载环境路由/灰度语义。
- **匿名公开经 `/chat/:app/:tag` 直达自定义标签版本**：非 production 标签仅管理员可达（见开放问题决策 Q1）；匿名公开只解析 production 指针。
- **C 端问答页与端到端 chat 编排**：属 M8。M7b 只交付 `resolveByTag` 解析 port + 管理员鉴权下的标签预览；`/chat/:appIdOrSlug/:tag?` 前端路由与流式在 M8 chat 替换 M2 桩后才端到端可用（现状 `chat.service.ts` 仍是 M2 mock，`ChatRequestSchema` 仍带 `agentId`）。
- M11 的完整评测集管理、质量报表和人工审批流。
- 任意节点/DAG；首期固定 rewrite/intent/reply/fallback 四节点。
- 多租户/RBAC；当前沿用单管理员 JWT 边界。
- 冻结知识库内容版本；应用固定知识库集合，但知识库 active version 可以独立演进。
- 把 Prompt 标签解释为应用运行依赖。

### Invariants

1. **应用配置版本业务字段不可修改**；任何变更必须追加新版本。
2. **只有已保存版本可以检查或上线**；前端未保存编辑态不得进入生产流程。
3. **应用版本固定 PromptVersion，PromptVersion 固定 ContractVersion**；运行时不解析 Prompt 标签。
4. **Prompt 标签移动永不影响应用**，包括 Prompt 的 `production` 标签。
5. **应用 production 恒为单一指针 `production_config_version_id`，不作为标签行存在**；匿名公开问答只解析该指针，不能选择任意版本。
6. **`production` 是应用标签命名空间的保留字**，禁止从自定义标签入口创建；移动 production = 走受门禁上线流程，不是标签 upsert。
7. **自定义标签仅管理员可解析**（`resolveByTag` 需管理员 JWT）；自定义标签移动即时、无门禁、无 ReleaseCheck。
8. **标签指向的版本必属同一应用**，由 `application_config_version_tags` 到 `application_config_versions(id, application_id)` 的复合 FK 在 DB 级保证。
9. **上线确认必须引用 passed、未过期且 fingerprint 匹配的 ReleaseCheck**，并通过 expected 指针 CAS + 归属守卫落库。
10. **真实预演与 Prompt 试运行、正式 chat 共用 NodeRuntime**；applications 不自行拼 Prompt 或解析模型输出。
11. **ReleaseCheck 不在数据库事务内等待模型**；最终 production 更新只使用短事务。
12. **停用高于 production**；恢复服务不改变 production 指针。
13. **观测故障不进入问答关键路径**，承接 001 全局不变量。

## Context

旧 M7 把“保存”“验证”“发布”压进两套状态机：版本 `draft/published/archived` 和 Eval `not_run/passed/exempt`。新建 v1 自动上线，Eval 在 M11 缺位时硬编码通过。新版原型改变了这一语义：编辑已有版本产生未保存修改，保存追加新版本，新版本默认未上线；上线时依次核对四节点实际回答，发现未在当前应用真实知识库上下文中验证的问题则阻断并引导去 Prompt 试运行。

012 同时把 Prompt 改成版本平权 + 标签模型，但明确规定 Prompt 标签没有发布语义。应用发布沿用这一教训但只借**范式不借语义**：`production` 保持为受门禁的单一指针（不是标签行），自定义命名锚点另建 `application_config_version_tags` 表、复用 012 的排他移动 + 复合 FK 归属做法。两者写路径必然分叉——production 需要 `expectedProductionVersionId` 的 compare-and-swap（有条件 WHERE 守卫），而 012 的标签移动是**无条件** `ON CONFLICT DO UPDATE`（靠无条件性拿并发串行）——这正是 production 不该寄居标签表的结构性理由（见 §Alternatives）。

## Goals / Non-goals

### Goals

- 线上配置可精确定位、可测试、可原子切换和回滚。
- 保存不等于上线；上线不接受未持久化内容。
- Prompt 的任何编辑或标签移动都不会静默改变线上应用。
- 发布问题能落到具体节点、PromptVersion、样例和 Trace，并提供可执行修复入口。
- 当前 production 在新版本检查失败、队列故障或模型故障时继续服务。

### Non-goals

- 不承诺一次 ReleaseCheck 等价于 M11 的语义质量评测。
- 不保存完整预演输入/输出到 Postgres。
- 不为低频发布提前引入独立配置中心或 Redis。

## Requirements & numbers

| 维度 | 假设/目标 | 算术与结论 |
|---|---|---|
| 应用规模 | 100 个 | 管理列表低频；超过 1,000 再分页/物化 |
| 版本规模 | 平均 50 版本/应用 | `100 × 50 = 5,000` 行 |
| 配置体积 | 每版本约 2–5 KB | 总量约 10–25 MB，Postgres 足够 |
| 公开问答 | 持续 20 QPS | 单指针 join p95 目标 `<10ms` |
| 静态门禁 | 只读数据库 + 纯函数 | p95 目标 `<500ms` |
| 真实预演 | rewrite/intent 各 10 例，reply/fallback 各 1 例 | 共 22 次 NodeRuntime 调用 |
| 预演耗时 | 单次平均 2s，并发 4 | `ceil(22/4) × 2 ≈ 12s`；慢模型可能 30–60s，必须异步 |
| 检查有效期 | 15 分钟 | 约束依赖变化窗口，同时允许人工确认 |
| 发布切换 | 一次 CAS + 更新时间 | 短事务 p95 目标 `<100ms` |

每天 10 次发布检查即 220 次节点调用，仍是低频控制面负载。每天超过 100 次或成本异常时再增加配额、样例缓存或分层检查。

## Design

### 领域组件

- `applications`：应用身份、production 指针、停用/软删状态。
- `application-configs`：前端 DTO 校验、不可变版本创建、列表与详情。
- `config-version-tags`：自定义命名锚点的排他移动/摘除、上限校验、复合 FK 归属（不含 production）。
- `release-checks`：静态门禁、样例选择、队列任务、fingerprint 和结果摘要。
- `ApplicationConfigResolver`：匿名公开（仅 production）、管理员带标签解析（`resolveByTag`）与显式版本测试共用的版本解析端口。
- `node-runtime`：接收 applications 准备的节点配置与运行上下文，执行真实预演；不依赖 applications。
- `prompts`：Prompt/PromptVersion/标签/编译与试运行；保持叶子，不依赖 applications。
- `chat`：只经 applications barrel 获取 ResolvedApplicationConfig。

### 数据模型

```text
applications
  id                            uuid PK
  slug                          text NOT NULL UNIQUE
  name                          text NOT NULL UNIQUE
  description                   text NOT NULL DEFAULT ''
  enabled                       boolean NOT NULL DEFAULT true
  production_config_version_id  uuid NULL
  deleted_at                    timestamp NULL
  created_by                    text NOT NULL
  created_at                    timestamp NOT NULL DEFAULT now()
  updated_by                    text NOT NULL
  updated_at                    timestamp NOT NULL DEFAULT now()

application_config_versions
  id                          uuid PK
  application_id              uuid NOT NULL REFERENCES applications(id)
  version                     integer NOT NULL
  config_schema_version       integer NOT NULL DEFAULT 1
  prompt_rewrite_version_id   uuid NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT
  prompt_intent_version_id    uuid NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT
  prompt_reply_version_id     uuid NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT
  prompt_fallback_version_id  uuid NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT
  rewrite_model_id            uuid NOT NULL REFERENCES model_providers(id) ON DELETE RESTRICT
  intent_model_id             uuid NOT NULL REFERENCES model_providers(id) ON DELETE RESTRICT
  reply_model_id              uuid NOT NULL REFERENCES model_providers(id) ON DELETE RESTRICT
  fallback_model_id           uuid NOT NULL REFERENCES model_providers(id) ON DELETE RESTRICT
  rerank_model_id             uuid NULL REFERENCES model_providers(id) ON DELETE RESTRICT
  node_params                 jsonb NOT NULL
  retrieval_params            jsonb NOT NULL
  fallback_params             jsonb NOT NULL
  note                        text NULL
  created_by                  text NOT NULL
  created_at                  timestamp NOT NULL DEFAULT now()

  UNIQUE(application_id, version)
  UNIQUE(id, application_id)   -- 复合 FK 被引用端：供 tags/指针的归属复合 FK 引用（加法迁移）
  INDEX(application_id, created_at DESC)

application_config_version_tags
  id                 uuid PK
  application_id     uuid NOT NULL   -- 冗余列，UNIQUE/复合 FK 的落点（照抄 012 prompt_version_tags.prompt_id）
  config_version_id  uuid NOT NULL
  name               text NOT NULL   -- 自定义锚点名，service 边界 lower() 归一；不含保留字 production/v
  created_by         text NOT NULL
  created_at         timestamp NOT NULL DEFAULT now()

  UNIQUE(application_id, name)       -- 排他性落点：应用内同名标签跨版本唯一
  FOREIGN KEY(config_version_id, application_id)
    REFERENCES application_config_versions(id, application_id) ON DELETE CASCADE   -- 复合 FK 归属保证
  INDEX(config_version_id)

application_config_version_kbs
  config_version_id  uuid NOT NULL REFERENCES application_config_versions(id) ON DELETE CASCADE
  kb_id              uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE RESTRICT
  PRIMARY KEY(config_version_id, kb_id)
  INDEX(kb_id)

application_release_checks
  id                  uuid PK
  application_id      uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE
  config_version_id   uuid NOT NULL REFERENCES application_config_versions(id) ON DELETE CASCADE
  config_fingerprint  text NOT NULL
  status              text NOT NULL -- queued|running|passed|failed|expired
  issues              jsonb NOT NULL DEFAULT '[]'
  sample_summary      jsonb NOT NULL DEFAULT '{}'
  started_at          timestamp NULL
  finished_at         timestamp NULL
  expires_at          timestamp NULL
  created_by          text NOT NULL
  created_at          timestamp NOT NULL DEFAULT now()

  INDEX(application_id, config_version_id, created_at DESC)
  INDEX(status, created_at)
```

`production_config_version_id` 必须属于同一 application。现状该列是裸 uuid、**无 FK 也无运行时归属校验**（仅 backfill 事后 verify）；M7b 补两道保险：(1) 推荐给指针加 `(id, application_id)` 复合 FK（与标签表同款，循环 FK 用 deferred 或写序保证）；(2) CAS 上线语句内置 `AND EXISTS(... application_id=$app)` 归属守卫（见 §上线门禁）。自定义标签的归属由 `application_config_version_tags` 的复合 FK 在 DB 级强制，无需应用层协调。production 不进标签表，因此不存在"指针 + 标签"双写。

### 节点和检索配置契约

```ts
interface ApplicationNodeConfig {
  promptVersionId: string;
  modelId: string;
  freedom: "precise" | "balance" | "improvise" | "custom";
  temperature: number;
  topP: number;
}

interface ApplicationConfigFields {
  kbIds: string[];
  nodes: Record<PromptNode, ApplicationNodeConfig>;
  retrieval: {
    schemaVersion: 1;
    topK: number;
    topN: number;
    hybridEnabled: boolean;
    vectorWeight: number;
    rerankEnabled: boolean;
    rerankModelId?: string; // DTO 字段，repository 映射到独立 FK 列
    rerankThreshold?: number;
  };
  fallback: { toHuman: boolean };
}
```

所有 JSONB 写入前必须由 contracts 中 strict Zod schema 校验。Prompt 下拉可以展示标签、最新和“谁在用”提示，但持久化只保存 PromptVersion ID。

### 编辑、保存和上线

编辑态仅存在于前端：

```ts
interface ApplicationConfigDraft {
  basedOnVersionId: string | null;
  fields: ApplicationConfigFields;
  dirty: boolean;
}
```

- 载入生产或历史版本只生成前端副本，不修改数据库。
- “保存为新版本”创建下一不可变版本，允许存在 Prompt 编译错误或尚未验证的问题。
- dirty 编辑态禁止检查/上线；后端只接受真实 configVersionId。
- “上线这个版本”先创建 ReleaseCheck，不自动偷存新版本。
- 回滚等价于对历史版本重新做有效 ReleaseCheck 后移动 production 指针；不能因为它曾上线过就跳过当前依赖检查。

### Prompt 版本选择

应用可选择对应节点下的所有 PromptVersion，不按 Prompt 标签过滤。保存时校验版本存在、Prompt node 匹配、ContractVersion 存在。`compile_status=has_errors` 仍允许保存，以支持中间版本记录，但静态发布门禁必须阻断。

Prompt 标签移动、摘除或创建不会触发应用更新。PromptVersion 被任意应用版本引用时受 FK RESTRICT 保护。

### 上线门禁

第一层静态检查不调用模型：

1. 至少一个知识库；Embedding 模型和维度一致。
2. 四个 PromptVersion 存在、节点归属正确、ContractVersion 存在。
3. Prompt 编译无错误。
4. 四个 LLM 模型存在、启用且类型正确。
5. rerank 开启时模型合法。
6. `topN <= topK`；权重、阈值、temperature 和 Top P 在合法值域。
7. NodeRuntime 支持 config schema 与 ContractVersion。

第二层通过 NodeRuntime 真实预演：rewrite/intent 各 10 例，reply/fallback 各 1 冒烟。applications 负责提供应用配置、样例、模型参数、知识库派生的 `availableRoutes`、检索上下文和 citations；NodeRuntime 负责组装、模型调用、Schema/动态校验、一次修复和 Fallback。

011 的跨域接口修订为：

```ts
interface NodeSampleRequest {
  node: PromptNode;
  contractVersion: number;
  promptVersionId: string;
  promptBody: string;
  modelId: string;
  modelParams: { temperature: number; topP: number };
  samples: Array<{ input: unknown; runtimeContext: RuntimeContext }>;
}

interface NodeSampleResult {
  ok: boolean;
  results: Array<{
    sampleIndex: number;
    ok: boolean;
    fallbackUsed: boolean;
    issues: ValidationIssue[];
    traceId?: string;
  }>;
}

interface NodeRuntimeService {
  compileAndSample(request: NodeSampleRequest): Promise<NodeSampleResult>;
}
```

applications 逐节点调用该接口（四节点 = 4 次 `compileAndSample`）；NodeRuntime 不负责选择应用版本、知识库或生产指针。

**traceId 缺口（M8.0 协调项）**：`NodeSampleResult.results[].traceId` 在 `node-runtime.service.ts` 声明为 optional，但 `compileAndSample` 当前**从不填充**它（`executeStructured`/`streamText` 的 `withSpan` 未回传 spanContext），因此 §Prompt 试运行协作 的 `OPEN_PROMPT_TRY_RUN` 深链拿不到 traceId。修复需在 node-runtime 的 withSpan 闭包内读 `span.spanContext().traceId` 回传并透传——属 M8.0 模块改动，M7b 依赖此修复才能闭合"跳 Trace"。因字段 optional，缺失时静默降级（TS 不报错），须在实现时显式核验，而非等人工 QA 暴露。

### ReleaseCheck fingerprint

fingerprint 至少包含：ApplicationConfigVersion ID、四个 PromptVersion/ContractVersion、模型 ID 与 provider revision、节点参数、知识库 ID 集合和检查时的 KB active version。检查通过后默认 15 分钟有效；依赖改变或超时后不能用于上线。

Postgres 只保存错误代码、节点、样例序号、fallback 标记、统计和 Trace ID，不保存完整模型输入/输出。详细过程由受脱敏策略约束的 Trace 承载。

### 版本命名标签与「管理标识」

自定义标签是版本的稳定可读访问锚点（等价 git tag），与 production 指针**并存但分流程**：

- **排他移动**：`INSERT ... ON CONFLICT (application_id, name) DO UPDATE SET config_version_id = excluded...`，一条原子语句即时生效（照抄 012 §1）。无 ReleaseCheck、无门禁、无审计升级。摘除是 `DELETE ... WHERE application_id=$1 AND name=$2`。
- **命名规则**：仅字母/数字/`.`/`_`/`-`；service 边界 `lower(name)` 归一；保留字仅 `production`（走上线流程，不许从自定义入口创建）与 `v`（版本号前缀混淆，承 012）。`beta` 不保留、为普通锚点。
- **数量上限**：每应用 20 个自定义标签软上限，写路径 count 校验，超限 422。
- **前端移动确认**：目标标签当前指向别的版本时提示“将从 vX 移动到本版本”（对应原型「管理标识」弹窗橙色提示）。

**「管理标识」弹窗**共用一个入口列出所有标签，但**两套后端流程 + 两套二次确认**：`production` 行显示上线/回滚 + ReleaseCheck 状态 → 走受门禁上线（§上线门禁 + §上线请求 CAS）；自定义行显示即时移动/摘除 → 走 `PUT/DELETE /config-version-tags`。弹窗按保留字派发，**绝不把 production 走自定义标签端点**。

**应用列表两列**：「是否上线」由 production 指针驱动（已上线 vN / 未上线）；「标识」展示自定义锚点（`qa20260707` 等）。M7a 已按此拆分两列。

### 运行时解析

```ts
interface ApplicationConfigResolver {
  resolvePublic(applicationIdOrSlug: string): Promise<ResolvedApplicationConfig>;                       // 匿名，仅 production
  resolveByTag(applicationIdOrSlug: string, tag: string, actor: Admin): Promise<ResolvedApplicationConfig>; // 管理员，自定义锚点或 production
  resolveForTest(applicationId: string, configVersionId: string, actor: Admin): Promise<ResolvedApplicationConfig>;
}
```

- `resolvePublic`：匿名，拒绝顺序 deleted → disabled → production missing → resolved，**只解析 production 指针**。
- `resolveByTag`：**需管理员 JWT**（开放问题决策 Q1）。tag 省略或 `=production` → 读指针；tag 为自定义名 → 读标签表。匿名命中自定义标签 URL → 404（不泄露标签是否存在）。所有非正式解析标记 `rag.preview=true`，不污染正式会话统计。
- `resolveForTest`：管理员显式指定任何已保存版本，同样 `rag.preview=true`。
- **`slug` 创建后不可变**（`UpdateApplicationRequest` 只含 name/description/enabled），作为 `/chat/:slug/:tag` 的稳定解析键。

### API

| 操作 | 方法与路径 | 说明 |
|---|---|---|
| 列表/详情 | `GET /api/applications`、`GET /api/applications/:id` | 返回生产摘要和停用状态 |
| 新建 | `POST /api/applications` | 创建应用和未上线 v1 |
| 编辑基础信息 | `PATCH /api/applications/:id` | 仅 name/description/enabled |
| 删除 | `DELETE /api/applications/:id` | 删除配置/检查，保留历史解释策略 |
| 版本列表/详情 | `GET /api/applications/:id/config-versions[...]` | 只读不可变快照 |
| 新建版本 | `POST /api/applications/:id/config-versions` | 追加版本，不上线 |
| 对话测试 | `POST /api/applications/:id/config-versions/:versionId/chat` | 管理员显式版本测试（M7b 阶段为 per-node 预演，完整对话待 M8） |
| 移动标签 | `PUT /api/applications/:id/config-version-tags` | body `{ name, versionId }`，自定义锚点排他移动，即时无门禁；`name=production` 拒绝（走上线） |
| 摘除标签 | `DELETE /api/applications/:id/config-version-tags/:name` | 摘除自定义锚点 |
| 开始检查 | `POST /api/applications/:id/config-versions/:versionId/release-checks` | 静态失败返回 422，否则创建异步检查 |
| 检查状态 | `GET /api/applications/:id/release-checks/:checkId` | 轮询或配合 SSE |
| 上线/回滚 | `PUT /api/applications/:id/production` | 需要 passed check + expected pointer（CAS + 归属守卫） |
| 下线 | `DELETE /api/applications/:id/production` | CAS 清空指针，应用保留 |
| 删除 | `DELETE /api/applications/:id` | 软删（`deleted_at`），读路径过滤 `deleted_at IS NULL` |
| Prompt usage | `GET /api/applications/prompt-usage?promptId=:id` | applications 域只读派生视图 |

上线请求：

```json
{
  "versionId": "uuid",
  "releaseCheckId": "uuid",
  "expectedProductionVersionId": "uuid-or-null"
}
```

短事务内校验 check 归属/status/expiry/fingerprint、关键依赖，然后以 CAS + 归属守卫一步落库：

```sql
UPDATE applications
SET production_config_version_id = $versionId, updated_by = $actor, updated_at = now()
WHERE id = $appId
  AND production_config_version_id IS NOT DISTINCT FROM $expectedProductionVersionId   -- CAS
  AND EXISTS (SELECT 1 FROM application_config_versions
              WHERE id = $versionId AND application_id = $appId)                        -- 归属守卫（现状无 FK 兜底）
RETURNING production_config_version_id;
```

0 行需区分：CAS 失败（并发，409 要求刷新重试）vs 归属校验失败（400）。成功后写审计事件。`DELETE /production`（下线）= CAS set null，同样带 expected 守卫。repository 现状**无任何 production 指针更新方法**（`updateBase` 只改 name/description/enabled），此 CAS 方法与两个 controller 端点均需新建。

### Prompt 试运行协作

Prompt 试运行验证单个 PromptVersion；ReleaseCheck 验证四节点、模型、知识库和参数组合。单次 Prompt 试运行成功不能永久豁免应用检查。

ReleaseCheck 失败 issue 可返回 `OPEN_PROMPT_TRY_RUN` action，携带 applicationId、configVersionId、node、promptVersionId、sampleIndex 和 traceId。Prompt 页面据此加载相同模型参数与应用上下文。修复 Prompt 会生成新 PromptVersion；应用选择它并保存新的 ApplicationConfigVersion 后重新检查。

### “谁在用”查询

applications 域从 `applications.production_config_version_id → application_config_versions → 四个 prompt_version_id` 派生生产使用关系，返回应用 ID/name、应用配置版本和节点。PromptsService 不依赖 applications；Prompt 前端单独调用该只读端点，失败时隐藏增强信息，不阻塞编辑主体。

## Failure modes

| 场景 | 行为 |
|---|---|
| release 队列不可用 | 不能开始新检查；当前 production 继续服务 |
| 模型/NodeRuntime 超时 | 样例失败并记录；检查失败或按明确策略降级，production 不变 |
| worker 重复投递 | check ID 幂等；已完成任务不再次计费执行 |
| 检查后 KB/provider 变化 | fingerprint 不匹配，确认上线返回 409 |
| 两管理员同时上线 | expected pointer CAS，后提交者 409 |
| Prompt 标签移动 | 应用与 production 完全不变 |
| PromptVersion 删除被引用 | FK RESTRICT 转 409，不裸露 500 |
| dirty 编辑态请求上线 | 前端禁用；后端因无真实版本 ID 拒绝 |
| 摘除 production（下线） | 公开地址显示未上线；历史版本与自定义标签保留 |
| 自定义标签移动/摘除 | 即时生效、无门禁；不触发 ReleaseCheck、不改变 production |
| 自定义标签指向被删版本 | 复合 FK `ON DELETE CASCADE`：版本随应用删除时标签一并删除，无悬挂标签 |
| 自定义标签数超 20 | 写路径 422 拒绝；已存在标签不受影响 |
| 匿名访问 `/chat/:app/:tag`（自定义标签） | 404，不泄露标签是否存在；仅 production 对匿名解析 |
| 打 `production` 走自定义标签端点 | 端点拒绝（保留字）；上线只能经 `PUT /production` |
| ReleaseCheck 拿不到 traceId | `OPEN_PROMPT_TRY_RUN` 降级为不带 traceId 的跳转，直到 M8.0 补齐回传 |
| 应用停用 | 优先拒绝公开解析；恢复沿用原指针 |
| 应用软删后被访问 | 读路径 `deleted_at IS NULL` 过滤，resolve 走 deleted 分支拒绝 |
| 观测后端故障 | 保存最小检查摘要；不改变正式问答结果 |

## Rollout & operations

M7a 已完成 applications 模块、不可变版本与单指针地基（`apps/backend/src/modules/applications/`）。M7b 增量：

1. 加法迁移：`application_config_versions` 增 `UNIQUE(id, application_id)`；新增 `application_config_version_tags`（复合 FK 归属）；推荐给 `production_config_version_id` 补 `(id, application_id)` 复合 FK。
2. M8.0 协调：`compileAndSample` 回传 `traceId`（withSpan 内读 spanContext），供 ReleaseCheck 的 `OPEN_PROMPT_TRY_RUN` 深链。
3. 新增 `application_release_checks` 表与异步 worker；`POST release-checks` 静态门禁 + 入队 + 逐节点预演。
4. 新增 production 指针 CAS 方法（repository 现无）+ `PUT/DELETE /production` 端点（含归属守卫）。
5. 新增自定义标签 `PUT/DELETE /config-version-tags` + `resolveByTag`（管理员）；`resolvePublic` 只解析 production。
6. `deleteApplication` 由硬删改软删（`SET deleted_at=now()`），list/detail/resolve/promptUsage 读路径全部加 `deleted_at IS NULL` 过滤。
7. 前端应用详情 Playground：异步核对、问题跳转、确认上线、版本历史「管理标识」弹窗（打/移/摘标签）。
8. 验证后删除旧 `agents` 的 `status/eval_*/published_*` 和旧 eval/publish/rollback API，最终把 agents 目录/契约改名为 applications。

删除旧字段前可从旧 current pointer 回滚读路径；删除旧状态机与目录改名属 one-way door，必须在所有消费者迁移后执行。**匿名公开 `/chat/:appIdOrSlug/:tag?` 的端到端可用性依赖 M8 用真实编排替换 M2 chat 桩**——M7b 只交付解析 port 与管理员标签预览，不承诺公开 chat 页可用。

### Observability

控制面事件：`application.config_version.created`、`application.release_check.*`、`application.production.changed/cleared`、`application.disabled/enabled/deleted`。

指标：release check 耗时/结果/节点问题/模型调用数，production change 结果，public resolve 结果与耗时。

Trace 属性：

```text
rag.application.id
rag.application.config_version_id
rag.application.config_version
rag.application.release_check_id
rag.prompt.version_id
rag.prompt.contract_version
rag.node.name
rag.preview
rag.validation.error_code
rag.fallback.used
```

## Security

- 管理、显式版本对话测试、ReleaseCheck 与**自定义标签解析（`resolveByTag`）仅管理员可用**；匿名公开用户只访问 production 指针。自定义标签未过发布门禁，放匿名直达等于绕过 ReleaseCheck 安全门，故 `/chat/:app/:tag` 命中自定义标签时对匿名返回 404。
- ReleaseCheck 输入可能含真实用户问题，Postgres 不保存完整内容，日志和 Trace 遵循脱敏规则。
- 对话测试、预演和真实发布都要限流并记录成本，不得暴露模型密钥/System 全文。
- 上线、下线、停用、恢复和删除必须审计。
- 当前没有新增租户边界；引入多租户时所有表、查询、队列任务和唯一键必须增加 tenant scope。

## Alternatives considered

| 决策 | 选择 | 拒绝方案 | 决定因素与代价 |
|---|---|---|---|
| production 建模 | 混合 B+：指针权威 + 自定义标签独立表，production 不入表 | A：production 也做成标签行，上线=特判移动该行 | A 统一存储但不统一语义：production 需 CAS（有条件 WHERE），012 标签靠**无条件** upsert 拿并发串行，二者写路径必然分叉；且 `findPromptUsage`/`APP_SELECT` 等多处浅层读指针，改纯标签行要全部改写并失去指针语义。代价：两套机制（指针 + 标签表）而非一套 |
| production 建模 | 混合 B+ | C：纯指针、完全不做应用标签（原 009 方案） | 新用例要"版本命名可读引用"（QA/分享/书签），纯指针无法命名版本。代价：多一张标签表 |
| 标签归属完整性 | 复合 FK `(config_version_id, application_id)` | 应用层校验归属 | DB 级保证标签指向同应用版本（照抄 012）；代价：config_versions 需加 `UNIQUE(id, application_id)` |
| 自定义标签可见性 | 仅管理员 `resolveByTag` | 匿名公开可经 URL 直达 | 自定义标签未过门禁，匿名直达=绕过发布安全门；放弃"给非管理员分享 QA 链接"，留作 release channel Revisit |
| Prompt 绑定 | 固定 PromptVersion ID | 跟随 Prompt production | 防止标签移动导致线上漂移 |
| 编辑态 | 前端临时 draft | 数据库 draft version | 避免重建版本状态机；刷新前未保存内容会丢失 |
| 门禁 | 异步真实 NodeRuntime 预演 | 纯静态检查 | 原型要求看真实节点结果；增加耗时与模型成本 |
| 检查结果 | 短期 ReleaseCheck | 永久 validated 字段 | 依赖会变化；需要过期/fingerprint 逻辑 |
| 并发发布 | expected pointer CAS | 最后写入者覆盖 | 避免无感覆盖；冲突者需刷新重试 |
| Prompt 试运行 | 修复入口 | 单次成功永久豁免 | 单节点结果不能证明组合正确 |
| 预演输出 | Trace + DB 摘要 | 全量 JSONB 持久化 | 降低 PII/存储风险；详情依赖 Trace 可用性 |

## Assumptions

1. 应用只有一个 production 环境；需要**版本命名访问锚点**（自定义标签），但不需要多环境路由/灰度——`beta` 是普通锚点而非保留字。
2. Prompt 标签继续存在，但只作为 Prompt 域管理信息；应用标签与 Prompt 标签零耦合。
3. ReleaseCheck 可真实调用模型并产生可控费用。
4. 首期样例数沿用 011：rewrite/intent 各 10，reply/fallback 各 1。
5. `compileAndSample` 的 `modelParams.topP` 当前被接收但不注入模型（011/009 均无协议层落点），故预演不覆盖 topP 影响，与 Prompt 试运行一致。
6. PromptVersion body 与 ApplicationConfigVersion 都不可变；`applications.slug` 创建后不可变。
7. 知识库内容允许独立更新，不由应用版本冻结。
8. 只有已保存版本能测试、检查、打标签和上线。
9. 当前单管理员角色可以执行全部发布与标签动作；QA/分享在此模型下即管理员持链接。

## Revisit triggers

1. 需要 staging/beta 环境路由或**可分享给非管理员的 QA 链接**：设计 application release channels（受门禁），不把 ungated 自定义标签开放给匿名——重估 Q1 鉴权立场。
2. 自定义标签逼近 20/应用 或出现"谁能打标签"的权限诉求：重估上限与标签权限层。
3. 每天 ReleaseCheck 超过 100 次或成本异常：增加配额、样例缓存和分层门禁。
4. 22 次预演 p95 超过 60 秒：重估并发、样例数和离线评测集。
5. KB 更新频繁导致大量检查失效：重定义 fingerprint 或冻结 KB active version。
6. 引入审批流：production 更新升级为 release request + approver。
7. 应用超过 1,000：为 Prompt usage 和列表增加专用索引/物化视图。
8. 多租户落地：所有应用、版本、检查、标签和队列任务增加 tenant scope。

## References

- `RAG知识库问答系统设计/CodeCrushBot.dc.html`：完整新版管理台原型。
- `RAG知识库问答系统设计/应用详情·Playground.dc.html`：应用详情、编辑态、版本历史、真实上线自检与 Prompt 修复跳转。
- `docs/design/011-prompt-assembly-node-contracts.md`：NodeRuntime 和真实样例执行接口提供方（`compileAndSample`）。
- `docs/design/012-prompt-management-redesign.md`：Prompt 版本/标签排他移动 + 复合 FK 范式（本文自定义标签借用）、试运行和“谁在用”协作边界。
- `docs/design/008-m5-retrieval.md`：检索参数和 RetrieverPort。
- `apps/backend/src/modules/applications/`：M7a 已交付的 applications 模块（身份、不可变版本、单指针地基）——M7b 增量的落地基线。
- `apps/backend/src/modules/node-runtime/executor/node-runtime.service.ts`：`compileAndSample` 签名与 traceId 缺口（M8.0 协调项）。
- `packages/contracts/src/agents.ts`、`apps/backend/src/modules/agents/`：需要迁移下线的旧 M7 实现。
