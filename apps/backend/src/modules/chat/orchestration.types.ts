import type { ChatCitation, FallbackInfo, FallbackReason } from "@codecrush/contracts";

/** OrchestrationService.run 的完整结果（T1 非流式；controller 据此合成 SSE 事件序列）。 */
export interface OrchestrationResult {
  traceId: string;
  /** 落库成功时必有；持久化降级（边界 7 兜底）时可能缺失。 */
  convId?: string;
  replyText: string;
  citations: ChatCitation[];
  confidence?: number;
  coverage: "full" | "partial";
  isFallback: boolean;
  fallbackReasons: FallbackReason[];
  fallbackInfo: FallbackInfo;
}
