import { describe, expect, it } from "vitest";
import {
  ChangeOwnPasswordRequestSchema,
  ChangeOwnPasswordResponseSchema,
  UserProfileSchema,
} from "./users";

describe("user contracts", () => {
  it("accepts a valid user profile", () => {
    expect(
      UserProfileSchema.safeParse({
        id: "8f14e45f-ceea-467f-a8d5-91be1a2f3b6d",
        email: "demo@codecrush.local",
        displayName: "Demo Admin",
        status: "active",
        createdAt: "2026-07-05T00:00:00.000Z",
        updatedAt: "2026-07-05T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed email and short new password", () => {
    expect(
      UserProfileSchema.safeParse({
        id: "8f14e45f-ceea-467f-a8d5-91be1a2f3b6d",
        email: "not-an-email",
        displayName: "x",
        status: "active",
        createdAt: "2026-07-05T00:00:00.000Z",
        updatedAt: "2026-07-05T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      ChangeOwnPasswordRequestSchema.safeParse({ currentPassword: "a", newPassword: "short" })
        .success,
    ).toBe(false);
  });

  it("accepts change password roundtrip shapes", () => {
    expect(
      ChangeOwnPasswordRequestSchema.safeParse({
        currentPassword: "CodeCrushDemo123!",
        newPassword: "NewPassword456!",
      }).success,
    ).toBe(true);
    expect(ChangeOwnPasswordResponseSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
  });
});
