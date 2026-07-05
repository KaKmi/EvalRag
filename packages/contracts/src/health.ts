import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "error"]),
  db: z.enum(["up", "down"]),
  details: z.record(z.string(), z.object({ status: z.string() })).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
