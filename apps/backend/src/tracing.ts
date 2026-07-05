import "dotenv/config";
import { startNodeTelemetry } from "@codecrush/otel";

startNodeTelemetry({
  serviceName: "codecrush-backend",
  serviceVersion: "0.0.0",
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
