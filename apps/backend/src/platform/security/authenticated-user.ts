/** JWT 验证通过后挂在 request.user 上的最小主体 */
export type AuthenticatedUser = { id: string; email: string };
