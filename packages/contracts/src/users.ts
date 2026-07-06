import { z } from "zod";

export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1),
  status: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const ChangeOwnPasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
export type ChangeOwnPasswordRequest = z.infer<typeof ChangeOwnPasswordRequestSchema>;

export const ChangeOwnPasswordResponseSchema = z.object({ status: z.literal("ok") });
export type ChangeOwnPasswordResponse = z.infer<typeof ChangeOwnPasswordResponseSchema>;
