import { HealthResponseSchema, type HealthResponse } from "@codecrush/contracts";

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch("/health");
  return HealthResponseSchema.parse(await res.json());
}
