import { envSchema } from "../src/platform/config/config.schema";

const base = {
  DATABASE_URL: "postgres://codecrush:codecrush@localhost:5432/codecrush",
};

describe("envSchema JWT fail-fast", () => {
  it("JWT_SECRET 缺失 → 校验失败", () => {
    expect(envSchema.safeParse(base).success).toBe(false);
  });

  it("JWT_SECRET 过短（<32）→ 校验失败", () => {
    expect(envSchema.safeParse({ ...base, JWT_SECRET: "short" }).success).toBe(false);
  });

  it("合法 JWT_SECRET → 通过且 JWT_EXPIRES_IN 默认 12h", () => {
    const r = envSchema.safeParse({
      ...base,
      JWT_SECRET: "dev-only-change-me-please-32-chars-min!!",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.JWT_EXPIRES_IN).toBe("12h");
  });
});
