import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { Resource } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { setForceFlushHookForTelemetry } from "./trace";
import { RedactingSpanExporter } from "./redact";

let sdk: NodeSDK | undefined;
let spanProcessor: BatchSpanProcessor | undefined;

export type StartNodeTelemetryOptions = {
  serviceName: string;
  serviceVersion?: string;
  otlpEndpoint?: string;
  enabled?: boolean;
  logger?: Pick<Console, "error" | "warn" | "info">;
};

export function startNodeTelemetry(options: StartNodeTelemetryOptions): void {
  const logger = options.logger ?? console;
  if (options.enabled === false || !options.otlpEndpoint) {
    logger.warn("[otel] tracing disabled: OTEL_EXPORTER_OTLP_ENDPOINT is not set");
    return;
  }
  if (sdk) return;

  try {
    // M8 T3：OTLP 导出前套一层脱敏——落 ClickHouse 前 scrub IO 敏感字段（信任边界咽喉）
    const traceExporter = new OTLPTraceExporter({ url: options.otlpEndpoint });
    const redactingExporter = new RedactingSpanExporter(traceExporter);
    spanProcessor = new BatchSpanProcessor(redactingExporter, { scheduledDelayMillis: 500 });
    sdk = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: options.serviceName,
        [ATTR_SERVICE_VERSION]: options.serviceVersion ?? "0.0.0",
      }),
      spanProcessors: [spanProcessor],
      instrumentations: [new HttpInstrumentation()],
    });
    sdk.start();
    setForceFlushHookForTelemetry(async () => {
      await spanProcessor?.forceFlush();
    });
    logger.info("[otel] tracing started");
  } catch (err) {
    logger.error("[otel] failed to start tracing", err);
    sdk = undefined;
  }
}

export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
  spanProcessor = undefined;
  setForceFlushHookForTelemetry(undefined);
}
