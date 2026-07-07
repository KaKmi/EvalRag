import type { ModelCallConfig } from "../../ports/model-provider.port";

/**
 * 连通性测试探针的请求描述：builder 是纯函数，只负责按协议构造请求与响应形状校验；
 * fetch / 超时 / latency / 密钥擦除统一在 ProtocolDispatchAdapter。
 */
export interface ProbeRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** 2xx 后的轻量形状校验：防"网关 200 但模型不可用"假阳性 */
  shapeOk: (json: unknown) => boolean;
}

export type ProbeBuilder = (config: ModelCallConfig) => ProbeRequest;

/** base 去尾斜杠后拼 path；若 base 已以 path 结尾则不重复拼（自部署常填全路径 base） */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return path && !base.endsWith(path) ? `${base}${path}` : base;
}

export function bearerHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

export function modelId(config: ModelCallConfig): string {
  return config.deploymentId ?? config.name;
}

export function isObj(json: unknown): json is Record<string, unknown> {
  return typeof json === "object" && json !== null;
}
