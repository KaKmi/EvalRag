import { describe, it, expect } from "vitest";
import { HealthResponseSchema } from "./health";

describe("HealthResponseSchema", () => {
  it("accepts an ok result", () => {
    const r = HealthResponseSchema.safeParse({
      status: "ok",
      db: "up",
      details: { db: { status: "up" } },
    });
    expect(r.success).toBe(true);
  });
  it("rejects invalid status", () => {
    expect(HealthResponseSchema.safeParse({ status: "green", db: "up" }).success).toBe(false);
  });
});
