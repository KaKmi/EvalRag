import { z } from "zod";

const traceIdSchema = z.string().regex(/^[a-f0-9]{32}$/i);
const spanIdSchema = z.string().regex(/^[a-f0-9]{16}$/i);

export const HelloTraceResponseSchema = z.object({
  traceId: traceIdSchema,
  spanId: spanIdSchema,
  name: z.literal("manual.hello"),
});
export type HelloTraceResponse = z.infer<typeof HelloTraceResponseSchema>;

export const TraceSpanSchema = z.object({
  traceId: traceIdSchema,
  spanId: spanIdSchema,
  parentSpanId: spanIdSchema.nullable(),
  name: z.string().min(1),
  kind: z.string().min(1),
  startTime: z.string().datetime(),
  durationMs: z.number().nonnegative(),
  statusCode: z.string(),
  attributes: z.record(z.string(), z.unknown()),
});
export type TraceSpan = z.infer<typeof TraceSpanSchema>;

export const TraceDetailResponseSchema = z.object({
  traceId: traceIdSchema,
  spans: z.array(TraceSpanSchema),
});
export type TraceDetailResponse = z.infer<typeof TraceDetailResponseSchema>;
