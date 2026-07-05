# Dev Ledger — M0.5 可观测最小闭环

Story 1: "otel-conventions + trace contracts" — complete
  Commits: 186c6f4 (code), d19f34f (docs/boundary/plan 前置)
  Files: packages/otel-conventions/{package.json,tsconfig.json,src/index.ts,src/index.test.ts},
         packages/contracts/src/{traces.ts,traces.test.ts,index.ts}, packages/contracts/src/otel.ts(删),
         pnpm-lock.yaml
  Produces:
    - @codecrush/otel-conventions: GEN_AI, RAG, OTEL_OPERATIONS, CODECRUSH_SPAN_KIND (as const)
    - @codecrush/contracts: HelloTraceResponseSchema/HelloTraceResponse (name: "manual.hello" literal,
      traceId 32-hex, spanId 16-hex), TraceSpanSchema/TraceSpan, TraceDetailResponseSchema/TraceDetailResponse
  Review: PASS（peer = fresh Agent 子会话；codex 到额度上限，同 provider 独立性较弱，已记录）
  Concerns: none

Story 2: "@codecrush/otel + backend preload" — complete
  Commits: 17fe799
  Files: packages/otel/{package.json,tsconfig.json,src/index.ts,src/node-sdk.ts,src/trace.ts,src/trace.test.ts},
         apps/backend/src/tracing.ts, apps/backend/test/tracing.spec.ts,
         apps/backend/package.json, apps/backend/jest.config.js, pnpm-lock.yaml
  Produces:
    - @codecrush/otel: startNodeTelemetry(opts)、withSpan(name,opts,fn)、
      emitManualHelloSpan(): Promise<SpanIdentity{traceId,spanId,name}>、forceFlushTelemetry(ms?)、
      shutdownTelemetry()、setForceFlushHookForTelemetry、resetTelemetryForTests、SpanIdentity/SpanAttributes/StartNodeTelemetryOptions
    - backend `start` = `node -r ./dist/tracing.js dist/main.js`（Nest bootstrap 前预加载）
    - jest 映射 @codecrush/otel(-conventions)
  Dev 修正：pinned @opentelemetry/resources@1.30.1 无 resourceFromAttributes（2.x API），改 `new Resource(...)`
  Review: PASS（peer = fresh Agent；同 codex 额度上限 fallback）
  Concerns: 2 项 latent（见 concerns.md），无当前触发，未修

Story 3: "ClickHouse platform + traces API" — complete
  Commits: 8809621
  Files: apps/backend/src/platform/config/{config.schema.ts,config.service.ts}, apps/backend/.env.example,
         apps/backend/src/platform/clickhouse/{clickhouse.constants.ts,clickhouse.module.ts,clickhouse.types.ts},
         apps/backend/src/modules/traces/{traces.module.ts,traces.controller.ts,traces.service.ts,clickhouse-traces.repository.ts},
         apps/backend/test/traces.controller.spec.ts, apps/backend/src/app.module.ts,
         apps/backend/package.json（+@clickhouse/client）, pnpm-lock.yaml
  Produces:
    - AppConfigService.clickHouse{Url,Database,Username,Password} + otelExporterOtlpEndpoint getters
    - platform/clickhouse: CLICKHOUSE(Symbol) 注入 @clickhouse/client（@Global）
    - modules/traces: TracesService.emitHello()/getTrace(id)、ClickHouseTracesRepository.findByTraceId/ensureTraceViews
    - HTTP: POST /traces/hello、GET /traces/:traceId（经 VIEW codecrush_trace_spans 读）
    - 依赖：runtime 读 infra/clickhouse/views/001-trace-views.sql（Task 4 建）
  Dev 修正：resolveTraceViewSqlPath（__dirname 向上找 pnpm-workspace.yaml）、toIsoUtc（UTC 毫秒 ISO，N3）、N1 显式 DTO
  Review: PASS（peer 亦核验了两处 dev 修正与 @clickhouse/client 泛型；[UNVERIFIABLE] 埋点不阻塞启动
    由 Story 2 已确证：node-sdk.startNodeTelemetry try/catch 不抛）
  Concerns: none
