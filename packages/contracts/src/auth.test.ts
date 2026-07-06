import { describe, expect, it } from "vitest";
import { LoginRequestSchema, LoginResponseSchema } from "./auth";

const user = {
  id: "8f14e45f-ceea-467f-a8d5-91be1a2f3b6d",
  email: "demo@codecrush.local",
  displayName: "Demo Admin",
  status: "active",
  createdAt: "2026-07-05T00:00:00.000Z",
  updatedAt: "2026-07-05T00:00:00.000Z",
};

describe("auth contracts", () => {
  it("accepts valid login roundtrip", () => {
    expect(
      LoginRequestSchema.safeParse({ email: "demo@codecrush.local", password: "x" }).success,
    ).toBe(true);
    expect(
      LoginResponseSchema.safeParse({
        accessToken: "header.payload.sig",
        tokenType: "Bearer",
        expiresIn: 43200,
        user,
      }).success,
    ).toBe(true);
  });

  it("rejects bad shapes", () => {
    expect(LoginRequestSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
    expect(
      LoginResponseSchema.safeParse({ accessToken: "t", tokenType: "bearer", expiresIn: 1, user })
        .success,
    ).toBe(false);
    expect(
      LoginResponseSchema.safeParse({ accessToken: "t", tokenType: "Bearer", expiresIn: 0, user })
        .success,
    ).toBe(false);
  });
});
