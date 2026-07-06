import type { TagKey } from "./agents";

/** M2 mock：Prompt 管理页用，对齐原型 PROMPT_ROWS / PROMPT_BODIES / PROMPT_VERS。M6 接真实 /api/prompts。 */

export type PromptNode = "问题改写" | "意图识别" | "回复生成" | "兜底";

export const NODE_TAGS: Record<PromptNode, TagKey> = {
  问题改写: "blue",
  意图识别: "purple",
  回复生成: "green",
  兜底: "gold",
};

export const NODE_META: Record<PromptNode, { hint: string; vars: string[] }> = {
  问题改写: {
    hint: "结合历史对话把用户问题改写为独立、可检索的查询，输出改写结果与扩展关键词。",
    vars: ["{question}", "{history}"],
  },
  意图识别: {
    hint: "判断用户问题意图并路由到对应知识库，通常要求输出结构化 JSON。",
    vars: ["{question}"],
  },
  回复生成: {
    hint: "基于命中知识生成最终回复，需约束“不得编造”并为每条引用标注角标。",
    vars: ["{context}", "{question}", "{policy_date}", "{user_level}"],
  },
  兜底: {
    hint: "当问题超出知识库范围或相似度过低时的礼貌兜底话术。",
    vars: ["{question}"],
  },
};

export const VAR_PH: Record<string, string> = {
  "{question}": "如：7 天内没学能全额退吗",
  "{history}": "如：用户此前咨询过退款政策",
  "{context}": "如：第二条 七天无理由退款…",
  "{policy_date}": "2026-06-18",
  "{user_level}": "零基础",
  "{intent}": "售后",
};

export interface PromptRow {
  name: string;
  node: PromptNode;
  tag: TagKey;
  ver: string;
  vars: string;
  by: string;
}

export const PROMPT_ROWS: PromptRow[] = [
  { name: "问题改写-通用", node: "问题改写", tag: "blue", ver: "v7", vars: "{question} {history}", by: "林晓 · 06-28" },
  { name: "意图识别-三分类", node: "意图识别", tag: "purple", ver: "v4", vars: "{question}", by: "林晓 · 06-25" },
  { name: "售后回复生成", node: "回复生成", tag: "green", ver: "v12", vars: "{context} {question} {policy_date}", by: "陈默 · 06-30" },
  { name: "课程推荐生成", node: "回复生成", tag: "green", ver: "v9", vars: "{context} {question} {user_level}", by: "陈默 · 06-22" },
  { name: "兜底话术", node: "兜底", tag: "gold", ver: "v3", vars: "{question}", by: "林晓 · 05-19" },
];

export const PROMPT_BODIES: Record<string, string> = {
  "问题改写-通用":
    "你是一个查询改写助手。根据用户当前问题与历史对话，将其改写为独立、完整、可检索的查询。\n\n历史对话：\n{history}\n\n当前问题：{question}\n\n请输出：\n1. 改写后的完整问题\n2. 3-5 个扩展检索关键词",
  "意图识别-三分类":
    "判断用户问题的意图类别，从 [售后, 咨询, 学习] 中选择其一，并给出置信度与应路由的知识库。\n\n用户问题：{question}\n\n输出 JSON：{ \"intent\": \"\", \"confidence\": 0.0, \"kb\": [] }",
  售后回复生成:
    "你是 CodeCrush 平台的售后客服，只能依据下方「命中知识」回答，不得编造。每引用一段知识，请在句末标注对应角标 [n]。\n\n命中知识：\n{context}\n\n政策生效日期：{policy_date}\n\n用户问题：{question}",
  课程推荐生成:
    "你是课程顾问，依据命中知识为用户推荐合适课程，并说明理由。语气亲切专业。\n\n命中知识：\n{context}\n\n用户当前水平：{user_level}\n\n用户问题：{question}",
  兜底话术:
    "用户的问题超出了知识库范围。请礼貌告知无法回答，并引导其联系人工客服或查看帮助中心。\n\n用户问题：{question}",
};

/** 版本 diff 用的 body 模板（仅「问题改写-通用」有详细版本历史）。 */
export const PROMPT_V: Record<string, string> = {
  v6: "你是查询改写助手。根据历史对话与当前问题，改写为可检索的查询。\n\n历史对话：\n{history}\n\n当前问题：{question}\n\n请输出改写后的问题和 3 个关键词。",
  v7: PROMPT_BODIES["问题改写-通用"],
  v8: "你是一个查询改写助手。根据用户当前问题与历史对话，将其改写为独立、完整、可检索的查询。\n\n历史对话：\n{history}\n\n当前问题：{question}\n\n改写要求：必须保留原问题中的时间、金额、课程名等关键实体，不得丢失或改写。\n\n请输出：\n1. 改写后的完整问题\n2. 5-8 个扩展检索关键词",
};

export type PromptVersionStatus = "生产中" | "审批中" | "灰度中" | "已归档" | "草稿";

export interface PromptVersionDef {
  ver: string;
  status: PromptVersionStatus;
  by: string;
  time: string;
  note: string;
  /** 指向 PROMPT_V 的 key；若未命中则视为 inline body。 */
  body: string;
}

export interface PromptVerCfg {
  bind: { agent: string; av: string; pv: string }[];
  versions: PromptVersionDef[];
}

export const PROMPT_VERS: Record<string, PromptVerCfg> = {
  "问题改写-通用": {
    bind: [
      { agent: "售后支持", av: "v12", pv: "v7" },
      { agent: "课程顾问", av: "v9", pv: "v7" },
    ],
    versions: [
      { ver: "v8", status: "草稿", by: "林晓", time: "07-02 10:20", note: "补充关键实体保留要求，扩展关键词至 5-8 个", body: "v8" },
      { ver: "v7", status: "生产中", by: "林晓", time: "06-28 14:02", note: "当前线上版本", body: "v7" },
      { ver: "v6", status: "已归档", by: "陈磊", time: "06-20 09:11", note: "早期三关键词版本", body: "v6" },
    ],
  },
};

/** 版本状态色板（原型 STV）。 */
export const STV: Record<PromptVersionStatus, { bg: string; c: string; bd: string }> = {
  生产中: { bg: "#f6ffed", c: "#52c41a", bd: "#b7eb8f" },
  审批中: { bg: "#fffbe6", c: "#d48806", bd: "#ffe58f" },
  灰度中: { bg: "#e6f4ff", c: "#1677ff", bd: "#91caff" },
  已归档: { bg: "#fafafa", c: "rgba(0,0,0,.45)", bd: "#e8e8e8" },
  草稿: { bg: "#f9f0ff", c: "#722ed1", bd: "#d3adf7" },
};

/** 新建/编辑抽屉表单。 */
export interface PromptDraft {
  isNew: boolean;
  orig: string;
  name: string;
  node: PromptNode;
  ver: string;
  vars: string;
  by: string;
  body: string;
  note: string;
  varExamples: Record<string, string>;
}

export function newPromptDraft(): PromptDraft {
  return {
    isNew: true,
    orig: "",
    name: "",
    node: "回复生成",
    ver: "v1",
    vars: "",
    by: "—",
    body: "",
    note: "",
    varExamples: {},
  };
}

export function editPromptDraft(r: PromptRow, body: string): PromptDraft {
  return {
    isNew: false,
    orig: r.name,
    name: r.name,
    node: r.node,
    ver: r.ver,
    vars: r.vars,
    by: r.by,
    body,
    note: "",
    varExamples: {},
  };
}

/** 解析 body 中的 {var} 占位符（去重，保序）。 */
export function detectVars(body: string): string[] {
  return [...new Set((body || "").match(/\{[a-zA-Z_]+\}/g) || [])];
}

/** 用示例值填充 body 生成预览。 */
export function previewBody(body: string, examples: Record<string, string>): string {
  if (!body.trim()) return "（Prompt 内容为空，先在上方编写模板）";
  let out = body;
  for (const v of detectVars(body)) {
    const val = (examples[v] || "").trim();
    if (val) out = out.split(v).join(val);
  }
  return out;
}

/** 行级 LCS diff（对齐原型 lineDiff）。 */
export function lineDiff(a: string, b: string): { type: "same" | "add" | "del"; text: string }[] {
  const A = (a || "").split("\n");
  const B = (b || "").split("\n");
  const m = A.length;
  const n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: { type: "same" | "add" | "del"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) {
      out.push({ type: "same", text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: A[i] });
      i++;
    } else {
      out.push({ type: "add", text: B[j] });
      j++;
    }
  }
  while (i < m) out.push({ type: "del", text: A[i++] });
  while (j < n) out.push({ type: "add", text: B[j++] });
  return out;
}

/** 取版本 body：若 body 字段命中 PROMPT_V 则取模板，否则视为 inline。 */
export function bodyOf(v: PromptVersionDef): string {
  return PROMPT_V[v.body] != null ? PROMPT_V[v.body] : v.body;
}
