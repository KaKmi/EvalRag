import { z } from "zod";

export const MessageRoleSchema = z.enum(["user", "assistant"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const ConversationSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  userId: z.string().min(1).optional(),
  title: z.string().min(1),
  updatedAt: z.string().datetime().optional(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const ConversationListResponseSchema = z.array(ConversationSchema);
export type ConversationListResponse = z.infer<typeof ConversationListResponseSchema>;

// M8 兜底上下文快照（落库供历史回放，013 §7）
export const FallbackInfoSchema = z.object({
  reasons: z.array(z.string()),
  topScore: z.number().optional(),
  threshold: z.number().optional(),
  scopeKbNames: z.array(z.string()).optional(),
});
export type FallbackInfo = z.infer<typeof FallbackInfoSchema>;

export const MessageSchema = z.object({
  id: z.string().min(1),
  convId: z.string().min(1),
  role: MessageRoleSchema,
  content: z.string(),
  traceId: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  coverage: z.enum(["full", "partial"]).optional(),
  isFallback: z.boolean().optional(),
  fallbackInfo: FallbackInfoSchema.optional(),
  citations: z.array(z.string().min(1)).optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const MessageListResponseSchema = z.array(MessageSchema);
export type MessageListResponse = z.infer<typeof MessageListResponseSchema>;
