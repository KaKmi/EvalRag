import { z } from "zod";
import type { StructuredOutputSpec } from "../models/ports/model-provider.port";

const MAX_ATTEMPTS = 2;

export function structuredOutput(name: string, schema: z.ZodType): StructuredOutputSpec {
  return {
    name,
    schema: z.toJSONSchema(schema) as Record<string, unknown>,
    strict: true,
  };
}

export function parseJudgeOutput<T>(content: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(content));
}

export async function withJudgeRetry<T>(
  metric: "faithfulness" | "answer relevancy" | "context precision",
  attempt: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index < MAX_ATTEMPTS; index += 1) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${metric} judge output invalid after retry`, { cause: lastError });
}

export function limitedEvidence(values: string[], emptyMessage: string): string[] {
  return values.length === 0 ? [emptyMessage] : values.slice(0, 3);
}
