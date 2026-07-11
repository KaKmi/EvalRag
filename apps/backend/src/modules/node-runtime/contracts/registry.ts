import type { PromptNode } from "@codecrush/contracts";
import { REWRITE_CONTRACT } from "./rewrite.contract";
import { INTENT_CONTRACT } from "./intent.contract";
import { REPLY_CONTRACT } from "./reply.contract";
import { FALLBACK_CONTRACT } from "./fallback.contract";
import type { NodeContract } from "./types";

// v1 版本表；未来新增 contractVersion 时按 (node, version) 加行，不覆盖旧版本
// （001/011 不变量：PromptVersion 固定 ContractVersion，旧版本行为不因新版上线而改变）。
const REGISTRY: Record<PromptNode, Record<number, NodeContract<never, never, never>>> = {
  rewrite: { 1: REWRITE_CONTRACT as never },
  intent: { 1: INTENT_CONTRACT as never },
  reply: { 1: REPLY_CONTRACT as never },
  fallback: { 1: FALLBACK_CONTRACT as never },
};

export const NodeContractRegistry = {
  resolve(node: PromptNode, contractVersion: number): NodeContract<never, never, never> {
    const contract = REGISTRY[node]?.[contractVersion];
    if (!contract) {
      throw new Error(
        `未知 NodeContract：node=${node} contractVersion=${contractVersion}（服务 readiness 失败，不允许用最新版本替代）`,
      );
    }
    return contract;
  },
};
