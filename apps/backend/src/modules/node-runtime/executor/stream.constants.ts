/**
 * reply 流式首 token 熔断阈值：从请求发出到 chatStream 吐出第一个非空 delta 的最大等待。
 * 首版占位，未经压测（013 §Revisit：待真实供应商压测校准）。env 可覆盖。
 */
export const FIRST_TOKEN_TIMEOUT_MS = Number(process.env.FIRST_TOKEN_TIMEOUT_MS ?? 15_000);
