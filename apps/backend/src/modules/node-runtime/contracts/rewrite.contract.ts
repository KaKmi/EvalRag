import { z } from "zod";
import { NODE_CONTRACTS } from "@codecrush/contracts";
import type { NodeContract } from "./types";

const InputSchema = z.object({
  query: z.string().min(1),
  history: z.string().optional(),
});
const OutputSchema = z.object({
  rewrittenQuery: z.string().min(1).max(1000),
  keywords: z.array(z.string()).max(20).default([]),
});

export const REWRITE_CONTRACT: NodeContract<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>,
  Record<string, never>
> = {
  node: "rewrite",
  version: 1,
  key: "rewrite",
  consumer: "编排代码 · 拿去检索",
  weight: "重契约",
  runtimeMode: "structured",
  structuredMode: "json_schema",
  inputSchema: InputSchema,
  reservedDataSchema: z.object({}).strict(),
  outputSchema: OutputSchema,
  templateFields: NODE_CONTRACTS.rewrite.templateFields,
  systemInstructions:
    "你是 RAG 流程中的「问题改写」节点。将当前问题改写成可独立理解、适合知识库检索的问题。" +
    "不要回答问题，不要添加输入中不存在的事实。输出必须符合平台提供的 JSON Schema。",
  fallback: (input) => ({ rewrittenQuery: input.query, keywords: [] }),
};
