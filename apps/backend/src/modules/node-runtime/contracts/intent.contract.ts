import { z } from "zod";
import { INTENT_OUTPUT_KEYS, NODE_CONTRACTS, UNKNOWN_INTENT_KEY } from "@codecrush/contracts";
import type { NodeContract } from "./types";

const InputSchema = z.object({
  query: z.string().min(1),
  history: z.string().optional(),
});
// 014 D3：候选意图恒注入静态全表（非可达子集）——输出合法性（enum）与路由可达性（编排层）解耦。
const ReservedSchema = z.object({
  availableIntents: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      criteria: z.array(z.string()),
    }),
  ),
});
// 014 D3：enum 静态闭集（全表 ∪ CHAT ∪ UNKNOWN）——三协议都把 outputSchema 作硬约束下发，
// 非法值在解码层即被拒绝；不再输出 routeIds（路由映射归编排层）。
const OutputSchema = z.object({
  intent: z.enum(INTENT_OUTPUT_KEYS as unknown as [string, ...string[]]),
  confidence: z.number().min(0).max(1),
});

export const INTENT_CONTRACT: NodeContract<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>,
  z.infer<typeof ReservedSchema>
> = {
  node: "intent",
  version: 1,
  key: "intent",
  consumer: "编排代码 · 拿去路由",
  weight: "重契约",
  runtimeMode: "structured",
  structuredMode: "json_schema",
  inputSchema: InputSchema,
  reservedDataSchema: ReservedSchema,
  outputSchema: OutputSchema,
  templateFields: NODE_CONTRACTS.intent.templateFields,
  systemInstructions:
    "你是 RAG 流程中的「意图识别」节点。从平台在运行时注入的候选意图（含判断标准 criteria）中" +
    "选择最匹配的大分类：先匹配小分类判断标准，再归拢到所属大分类；闲聊/问候/寒暄归 CHAT；" +
    "无法归类归 UNKNOWN。只做判断，不回答问题。输出必须符合平台提供的 JSON Schema。",
  fallback: () => ({ intent: UNKNOWN_INTENT_KEY, confidence: 0 }),
};
