---
title: "两级意图表与知识库外挂意图路由"
description: "意图节点只做静态闭集大分类，路由靠 KB↔意图绑定映射；替换 013 的 KB-UUID 路由方案。"
category: "design"
number: "014"
status: draft
services: [backend, contracts, frontend]
related: ["design/002", "design/009", "design/011", "design/012", "design/013"]
last_modified: "2026-07-12"
---

# 014 — 两级意图表与知识库外挂意图路由

## Status

`draft` — 经 `/ship:arch-design`（完整对抗档：peer 独立调查 + diff）完成。**替换 [013](013-m8-rag-orchestration.md) §2 的意图路由方案与 P1-②**（旧方案 = intent 输出 `routeIds: KB UUID 数组`、`availableRoutes` 喂 `{id,name,desc}`）。用户 2026-07-12 对话拍板核心形态；对抗验证发现两处 P1（enum 结构保证不可弃、fingerprint 必须纳入绑定），均已采纳修正进本文。

M8 T1 的 plan（`.ship/tasks/m8-t1-orchestration-kernel/plan/`）中 Task 2 按本文重写，Task 1/5/6 局部调整，Task 3/4/7 正交不受影响（回改清单见 §D6）。

## Summary

意图节点不再输出 KB id：模型只做「**静态闭集 N 选 1**」的业务意图分类（大分类），路由靠「**KB 外挂大分类**」的配置映射完成。两级意图表（大分类 + 小分类判断锚点）第一版代码写死；KB↔意图绑定为真配置（`knowledge_bases.intent_key` 列）；**CHAT 闲聊为一等意图，直走兜底、不检索**。模型从「在裸 UUID 上选路由」变成「在个位数业务枚举里分类」，可靠性根本改善，且 UUID 越权校验、幻觉 id 修复整套复杂度被删除。

## 用户拍板（2026-07-12）

- 两级意图表：大分类（产品咨询 / 问题反馈 / 闲聊…）+ 每个大分类下的小分类（产品定位 / 产品价格 / 竞品比较…）。**小分类只作为喂给 LLM 的判断锚点**（用户输入先匹小分类再归拢到大分类，防止只给大分类判错）——**不做文档 metadata 过滤**（延后，依赖 M4 切片元数据 + M5 检索过滤；词表设计留复用余地）。
- 意图表是独立的标准表，第一版**代码写死**（[011](011-prompt-assembly-node-contracts.md) §7 同款「先写死、后 DB+UI」边界）；**KB 外挂大分类做成真配置**。
- 意图节点**输出大分类、不碰 KB id**；节点图不变（4 节点、rewrite 独立、不加 resolved_question/translation）。
- **CHAT 走现有兜底节点**。

## Boundaries

> 反漂移边界。任何实现越过以下范围，应先回来改本文。

**In-scope**

- `INTENT_TABLE` 常量（contracts 层）+ `CHAT`/`UNKNOWN` 保留 key。
- `knowledge_bases.intent_key` 列 + 迁移 + KB 契约/Create/Update 扩展 + service 双分支穿透。
- intent 契约就地 v1 改（reserved / output / systemInstructions）。
- 编排路由语义（CHAT / 绑定 key / UNKNOWN 三分支 + 未绑定通配）。
- ReleaseCheck 预演喂料同步 + **fingerprint 纳入 intentKey**。
- KB 表单 intentKey 选择器（antd Select，**原型外新增**——沿 m7a「spec 外功能也要做」先例，用户可否决）。

**Out-of-scope**

- 小分类做文档 / 切片 metadata 过滤——延后，依赖 M4/M5。
- 意图表 DB 化 + 管理 UI——Revisit。
- KB 多意图绑定——v1 单绑定。
- KB 绑定版本化 / 门禁——接受与 KB 内容 `activeVersion` 独立演进同款取舍（[009](009-m7-application-management.md) 既定：知识库内容不由应用版本冻结）。
- 闲聊专用话术配置——v1 走兜底，Revisit。

**Invariants**

1. **意图输出永在静态闭集内**：outputSchema 用 enum 硬约束，三协议（openai_compat/anthropic/gemini）在解码层生效。
2. **模型不接触 KB id**：候选意图、判断标准是模型能看到的全部路由信息。
3. **检索范围只由「意图 → 绑定映射」+ 通配规则决定**，编排代码不消费模型自由文本。
4. **fingerprint 覆盖路由候选集**（kbs 项含 intentKey）：check→publish 窗口内改绑定即 fingerprint 失配，无法绕过预演。
5. **CHAT 不检索**。

## 设计决策

### D1 意图表（代码写死，contracts 层）

```ts
// packages/contracts/src/intent-table.ts
export interface IntentCategory { key: string; label: string; criteria: string[]; }
export const INTENT_TABLE: IntentCategory[] = [
  { key: "SUPPORT",  label: "产品咨询", criteria: ["产品定位", "产品原则", "产品理念", "使用场景", "产品价格", "竞品比较", "使用方法/操作步骤", "下载安装/注册登录/账号"] },
  { key: "FEEDBACK", label: "问题反馈", criteria: ["功能异常/报错/打不开/卡顿", "功能优化建议/希望增加功能"] },
];
export const CHAT_INTENT_KEY = "CHAT";       // 恒存在，不可绑 KB，不检索
export const UNKNOWN_INTENT_KEY = "UNKNOWN"; // 分类失败/无法归类
export const INTENT_OUTPUT_KEYS = [...INTENT_TABLE.map(c => c.key), CHAT_INTENT_KEY, UNKNOWN_INTENT_KEY] as const;
```

- `key` = 稳定标识（存 KB 绑定列、编排路由、trace）；`label`/`criteria` = 文案（未来可下沉 DB+UI，011 §7 同款边界：结构与校验留代码）。
- 小分类 = `criteria`，**仅作 LLM 判断锚点**（先匹小分类、归拢大分类），不做检索过滤。
- 选址 contracts 层 = FE/BE 共享（`NODE_CONTRACTS` 同形态先例，node-contract.ts:31-40），且 intentKey 契约校验可静态构造 enum。

### D2 KB 绑定（真配置）

- `knowledge_bases` 加 nullable **`intent_key text`**（单绑定 v1；不 FK——意图表在代码，同 `chunkTemplate`「text 落库、契约层收口」先例 knowledge-bases/schema.ts:5,10）。
- 契约：`KnowledgeBase` 加 `intentKey?: z.enum(业务 keys，排除 CHAT/UNKNOWN).nullable()`；Create/Update 请求同。**注意**：`UpdateKnowledgeBaseRequestSchema` 是 strictObject——必须显式扩字段否则 PATCH 400；`undefined`=不改 / `null`=解绑（`.nullable().optional()`）。
- service update 是**双分支各自拼 patch**（knowledge-bases.service.ts:148-159 profile 分支、:171-183 template 分支）——intentKey 必须两分支都穿透，防「带 profile 改时被静默丢弃」；service 层加值域纵深防御一条。
- intentKey 变更打**结构化审计日志**（同 `production.changed` 先例 applications.service.ts:250-252），KB 编辑处提示受影响应用数。
- UI 文案必须写明：**「不绑定 = 通用库，所有意图都会检索」**（防止管理员把"没绑"理解成"没启用"）。

### D3 intent 契约（就地 v1 改）【含对抗修正 P1-①】

沿 T1 spec R1 结论（contractVersion 建版本写死 =1、v2 无生成路径 = 死代码）就地改 v1：

- **outputSchema**：`{ intent: z.enum(INTENT_OUTPUT_KEYS), confidence: z.number().min(0).max(1) }`——**保留 enum 静态闭集**（全表 ∪ CHAT ∪ UNKNOWN）。对抗验证确认三协议都把 outputSchema 作硬约束下发（chat-builders.ts:83 openai `response_format` / :112-114 anthropic tool `input_schema` / :139 gemini `responseSchema`），enum 在**解码层**就挡住非法值；改 `z.string()` 会把结构保证降级为事后校验，修复/兜底率上升。**去掉 `routeIds`**。
- **reserved**：`availableRoutes: string[]` → **`availableIntents: [{key, label, criteria: string[]}]`，恒注入全表**（非可达子集）——子集注入会让「全未绑 KB 的存量应用」在 ReleaseCheck 冒烟时只能合法输出 CHAT/UNKNOWN，业务样例全翻车、门禁误杀；**输出合法性（enum）与路由可达性（编排层）解耦**。extraValidate 不再需要动态值域校验（enum 已收口），删除。
- **fallback**：`{ intent: "UNKNOWN", confidence: 0 }`。
- **systemInstructions**：「从平台注入的候选意图（含判断标准）中选择；先匹配小分类再归拢到所属大分类；闲聊/问候/寒暄归 CHAT；无法归类归 UNKNOWN」。注入走 reserved（user JSON envelope，assemble.ts:18-21 组装器零改动，011 两层组装不变量保持）。
- **reservedFields 改名波及 012 静态字段契约**：node-contract.ts:33 一行改 + `compilePromptBody` 查表泛化零逻辑改（node-contract.ts:148-155）。存量写 `{availableRoutes}` 的正文本就是 has_errors（RESERVED_FIELD），改名后变 UNKNOWN_VARIABLE 仍是 error——**无静默放行窗口**。

### D4 编排路由语义

| intent 输出 | 编排行为 | 备注 |
|---|---|---|
| `CHAT` | **不检索**，直走 fallback 节点整段 streamText；`fallbackReasons=["chitchat","handled_by_fallback"]` | FallbackReason 枚举加 `chitchat`（T1 未 ship，零成本）。已知产品语义错位：fallback 话术是「没找到答案」类文案回应「你好」——v1 接受（用户拍板走兜底），文档提示管理员写中性话术；平台内置 CHAT 专用话术常量列 Revisit |
| 业务 key `K` | 检索集 = **绑定到 K 的 KB ∪ 全部未绑定 KB**（未绑定 = 通配）；检索集为空 → 回退全 kbIds | 通配的召回单调性：逐个绑定不会让未绑库突然查不到；绑定是对**被绑库**的收窄（非 K 问题不再查它），正是绑定本意 |
| `UNKNOWN` / 节点降级 | 全 kbIds 召回 | 013 既定「不过窄」 |

成本记录：全 KB 路径 = 同 query 重复 embed N 次（既有 013 成本，非本设计新增）；query embedding 缓存列 Revisit。

### D5 发布门禁同步【含对抗修正 P1-②】

- `release-check.processor` 注入 `KnowledgeBasesService`（T1 plan F7 既定路径，applications.module.ts:13 已 import）；`buildSamples` 的 intent reserved 改 `availableIntents = 全表`（与运行时一致）。
- **fingerprint 的 kbs 项加 `intentKey`**（applications.service.ts:489 一行）——否则「跑 check → 改绑定 → publish」窗口内，上线时的路由候选集与预演验证的不一致，击穿 009「fingerprint 匹配」不变量的设计意图。
- prompts tryRun（prompts.service.ts:239-244）同样注入全表（替代空数组，试运行保真度顺带提升）。

### D6 回改清单（实现波同步执行）

**文档**：[013](013-m8-rag-orchestration.md) §2 意图行 + P1-②（已标注被本文取代）；[011](011-prompt-assembly-node-contracts.md) §intent 契约（availableRoutes→availableIntents + enum 注记，已加）；[012](012-prompt-management-redesign.md) §5 字段表（reservedFields 改名）+ 示例；[002](002-implementation-roadmap.md) M8.0 需求记录第 2 条 availableRoutes 措辞；[009](009-m7-application-management.md) KB 配置面涉及处。

**T1 plan**（`.ship/tasks/m8-t1-orchestration-kernel/plan/`）：
- Task 2 **重写**（新 payload：INTENT_TABLE + availableIntents + enum 输出；文件集几乎不变——intent.contract / runtime-context / release-check.samples / release-check.processor / prompts.service + 同一批测试）。
- Task 1：`FallbackReasonSchema` 加 `chitchat`。
- Task 5：`decideFallback` 判据改（`intent==="UNKNOWN"` 语义 + CHAT 独立分支——CHAT 不进检索，不适用现有函数签名，编排层先分流）。
- Task 6：availableIntents 构造（全表）+ 「key→绑定 KB ∪ 通配」映射路由，替代 `routeIds.length ? routeIds : cfg.kbIds`。
- spec：AC3 / R1 / 合并结论 7 重写。
- **Task 3 / 4 / 7（持久化 / 检索映射 / SSE 接线）正交，照跑**。

**新增**：contracts `intent-table.ts`；KB 契约 + schema 列 + 迁移 + service 穿透 + 审计日志；前端 KB 表单 intentKey antd Select（原型外新增，沿 m7a 先例；`mocks/traces.ts` 路由文案过时属 cosmetic 顺带清）。

## Trade-offs

| 决策 | 选择 | 放弃 | 理由 |
|---|---|---|---|
| 输出值域 | enum 静态闭集 | `z.string()` + extraValidate 动态校验 | 三协议解码层硬约束、修复/兜底率低；代价 = 意图表 DB 化时需动态构建 schema（Revisit） |
| 注入集 | 恒全表 | 可达子集 | 消除空候选退化 / 门禁误杀；输出合法性与路由可达性解耦；代价 = 模型可能选中不可达 key，由路由层通配兜 |
| 未绑定 KB | 通配（参与所有业务意图） | 仅 UNKNOWN 可达 | 召回单调、渐进采纳不破存量；反向方案会「绑了第一个库，其余未绑库从所有分类消失」 |
| KB 绑定数 | 单绑定（nullable 列） | 多绑定（join 表） | 最简迁移；多绑定 Revisit |
| 绑定版本化 | 不版本化（fingerprint + 审计日志兜） | 版本化/门禁 | 与 KB activeVersion 独立演进同款既定取舍；版本化与「轻量真配置」拍板矛盾 |
| CHAT 出口 | 走兜底节点（用户拍板） | 平台专用话术常量 / fallbackParams 字段 | 不加节点不动 schema；话术错位登记 Revisit |

## Assumptions

- 意图表规模小（个位数大分类），enum / prompt 注入无体积问题。
- 应用绑定 KB 个位数量级（全 KB 回退成本可接受）。
- 011 两层组装与 executeStructured 校验/修复/降级链稳定。
- T1 R1 结论有效（contractVersion 无 v2 生成路径 → 就地改 v1 是唯一生效路径）。

## Revisit triggers

- **意图表 DB 化 + 管理 UI**：届时 outputSchema enum 需按表动态构建，并显式声明与 011「PromptVersion 固定 ContractVersion、行为不变」不变量的豁免（意图表独立演进，同 KB activeVersion 先例）。
- KB 多意图绑定。
- 小分类下沉为切片 metadata tag 做库内过滤（依赖 M4 切片元数据 + M5 检索过滤）。
- CHAT 专用话术（平台常量或 `fallbackParams.chitchatText`）；进一步的闲聊直答（不走兜底、走轻量对话）。
- query embedding 缓存（全 KB 路径重复 embed）。

## References

- 编排内核：`013-m8-rag-orchestration`（本文替换其 §2 意图路由与 P1-②）
- NodeContract 执行引擎与 §7 写死/可配置边界：`011-prompt-assembly-node-contracts`
- 静态字段契约（reservedFields）：`012-prompt-management-redesign`
- 应用发布闭环与 fingerprint：`009-m7-application-management`
- 产品输入：用户提供的真实意图识别 prompt 形态（两级分类表 + 按大分类判断标准 + 闲聊兜底规则）
