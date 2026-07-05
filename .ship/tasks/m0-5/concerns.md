# Concerns — M0.5

## Story 2 (@codecrush/otel) — PASS_WITH_CONCERNS 级 latent 项（reviewer 标注，无当前触发，未修）

1. `packages/otel/src/trace.ts` `resetTelemetryForTests()` 只清 `forceFlushHook`，不重置
   `trace.setGlobalTracerProvider(...)` 设的进程级 global provider。OTel 的 setGlobalTracerProvider
   二次调用会被忽略（返回 false）。当前每个 runner 只有一个测试注册 provider（vitest 仅
   trace.test.ts、jest 仅 tracing.spec.ts），无冲突。**若日后给同一 runner 再加一个 telemetry 测试**，
   会静默复用前一个 provider，导致断言假过/假败。加测试时需在此提供 provider 重置。
2. `packages/otel/src/node-sdk.ts` 若 `sdk.start()` 抛错，catch 里重置 `sdk=undefined` 但
   module 级 `spanProcessor` 仍指向孤儿 BatchSpanProcessor（未 flush/shutdown）。下次成功 start 会覆盖，
   retry 可用，但旧 processor 泄漏。BatchSpanProcessor+OTLP-gRPC 的 start 正常不抛，暂无真实触发。
