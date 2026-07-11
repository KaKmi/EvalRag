import { NODE_CONTRACTS, type PromptNode } from "@codecrush/contracts";
import type { TagKey } from "./agents";

/**
 * M6：Prompt 管理页 UI 常量（颜色 / hint / 示例值 / 状态色板）。
 * 类型对齐 contracts 英文 enum（rewrite/intent/reply/fallback），
 * 用 NODE_LABEL 在 UI 显中文。mock 数据与本地纯函数已迁出——
 * 数据走 `@codecrush/contracts` 的 Prompt/PromptVersion + `api/client`；
 * 纯逻辑（extractVars/renderTemplate/diffPromptBodies）走 contracts/prompt-template。
 */

export type { PromptNode };

/** 节点 → UI 颜色 tag。 */
export const NODE_TAGS: Record<PromptNode, TagKey> = {
  rewrite: "blue",
  intent: "purple",
  reply: "green",
  fallback: "gold",
};

/** 节点 → 中文标签。 */
export const NODE_LABEL: Record<PromptNode, string> = {
  rewrite: "问题改写",
  intent: "意图识别",
  reply: "回复生成",
  fallback: "兜底",
};

// vars 来自 contracts 的 NODE_CONTRACTS 静态字段契约（012 §5 唯一事实源），
// 此处只补 UI 文案（hint），不再重复维护字段表。
const NODE_HINT: Record<PromptNode, string> = {
  rewrite: "结合历史对话把用户问题改写为独立、可检索的查询，输出改写结果与扩展关键词。",
  intent: "判断用户问题意图并路由到对应知识库，通常要求输出结构化 JSON。",
  reply: "基于命中知识生成最终回复，需约束“不得编造”并为每条引用标注角标。",
  fallback: "当问题超出知识库范围或相似度过低时的礼貌兜底话术。",
};

export const NODE_META: Record<PromptNode, { hint: string; vars: string[] }> = Object.fromEntries(
  (Object.keys(NODE_HINT) as PromptNode[]).map((node) => [
    node,
    { hint: NODE_HINT[node], vars: NODE_CONTRACTS[node].templateFields.map((f) => `{${f}}`) },
  ]),
) as Record<PromptNode, { hint: string; vars: string[] }>;

/** 变量 → 示例值（预览填充用）。 */
export const VAR_PH: Record<string, string> = {
  "{query}": "如：7 天内没学能全额退吗",
  "{history}": "如：用户此前咨询过退款政策",
  "{retrievalContext}": "如：第二条 七天无理由退款…",
  "{reason}": "如：知识库中未命中相关内容",
};

/**
 * 编译期护栏：`Record<PromptNode, TagKey>`
 * 强制 UI 常量 key 覆盖契约 enum 全部成员；契约加新枚举时此处编译失败，提醒同步 UI。
 */
