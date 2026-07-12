import { z } from "zod";

export const ChatRequestSchema = z.object({
  convId: z.string().min(1).optional(),
  agentId: z.string().min(1),
  query: z.string().min(1),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatCitationSchema = z.object({
  n: z.number().int().positive(),
  doc: z.string(),
  kb: z.string(),
  section: z.string(),
  score: z.number().min(0).max(1),
});
export type ChatCitation = z.infer<typeof ChatCitationSchema>;

export const ChatTokenEventSchema = z.object({
  type: z.literal("token"),
  delta: z.string(),
});

export const ChatCitationEventSchema = z.object({
  type: z.literal("citation"),
  citation: ChatCitationSchema,
});

// M8 兜底原因（013 §6 四原因 + 014 CHAT 闲聊）
export const FallbackReasonSchema = z.enum([
  "out_of_scope",
  "low_similarity",
  "empty_retrieval",
  "chitchat",
  "handled_by_fallback",
]);
export type FallbackReason = z.infer<typeof FallbackReasonSchema>;

export const ChatDoneEventSchema = z.object({
  type: z.literal("done"),
  traceId: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  coverage: z.enum(["full", "partial"]),
  isFallback: z.boolean(),
  fallbackReasons: z.array(FallbackReasonSchema),
});

export const ChatErrorEventSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
});

export const ChatStreamEventSchema = z.discriminatedUnion("type", [
  ChatTokenEventSchema,
  ChatCitationEventSchema,
  ChatDoneEventSchema,
  ChatErrorEventSchema,
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;
