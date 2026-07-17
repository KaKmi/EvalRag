import "dotenv/config";
import { startNodeTelemetry } from "@codecrush/otel";
import { parseProcessRole } from "./platform/config/process-role";

// 019 D3：serviceName 按角色分——读模型不按 ServiceName 过滤（019 已验证），
// 运维得到「span 来自哪个进程」维度。非法 role 在此 throw = fail-fast 早于任何 span 发出。
const role = parseProcessRole(process.env);

startNodeTelemetry({
  serviceName: role === "worker" ? "codecrush-worker" : "codecrush-backend",
  serviceVersion: "0.0.0",
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
