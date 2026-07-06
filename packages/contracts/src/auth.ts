import { z } from "zod";
import { UserProfileSchema } from "./users";

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number().int().positive(),
  user: UserProfileSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
