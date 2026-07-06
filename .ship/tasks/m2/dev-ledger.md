# M2 Dev Ledger

Story 0: "修订 003/006 设计文档" — complete
  Commits: 8b6a435
  Files: docs/design/003-code-organization.md, docs/design/006-m2-app-shell-skeleton.md
  Produces: 003 OpenAPI tooling revised; 006 route table 14 routes, 15-screen table fixed
  Concerns: none

Story 1: "后端全局配置 + nestjs-zod 迁移 + M1 测试修复" — complete (peer reviewed)
  Commits: 9762985 (impl) + 8ed6a42 (review fixes)
  Peer review: PASS_WITH_CONCERNS — 0 P1 / 3 P2 (all fixed in 8ed6a42) / 4 P3 (accepted, inert-by-design)
  Deps added: nestjs-zod@5.4.0, @nestjs/swagger@11.4.5 (backend)
  Files:
    - apps/backend/src/app/app-bootstrap.ts (NEW: applyGlobalConfig + setupSwagger helpers)
    - apps/backend/src/main.ts (wire prefix + swagger)
    - apps/backend/src/app.module.ts (APP_PIPE ZodValidationPipe + APP_INTERCEPTOR ZodSerializerInterceptor)
    - apps/backend/src/modules/auth/auth.controller.ts (createZodDto, drop manual safeParse)
    - apps/backend/src/modules/users/users.controller.ts (createZodDto, drop manual safeParse)
    - apps/backend/src/modules/traces/traces.controller.ts (keep defensive TRACE_ID_RE; comment corrected — pipe skips non-ZodDto @Param, regex is the actual validation)
    - apps/backend/test/auth.e2e.spec.ts (APP_PIPE + applyGlobalConfig; paths → /api/*)
    - apps/backend/test/openapi.e2e.spec.ts (NEW: GET /api/docs-json paths assertions)
    - apps/backend/test/zod-pipe.e2e.spec.ts (NEW: ZodValidationPipe 400 shape)
    - apps/backend/scripts/verify-observability.mjs (paths → /api/*)
    - docs/design/005-user-auth.md, 006, README.md (path refs → /api/*)
  Produces: global /api prefix (health excluded); Swagger UI at /api/docs + JSON at /api/docs-json; ZodValidationPipe global; M1 controllers migrated to createZodDto
  Tests: 12 suites / 33 tests green; lint 0; build ok
  Breaking change: API prefix /auth/login→/api/auth/login, /users/me→/api/users/me, /traces/*→/api/traces/* (/health unchanged)
  Concerns: none

Story 2: "契约扩展（11 个 schema 文件）" — complete (no individual review — non-security; covered by final review)
  Commits: a811276
  Files (NEW):
    - packages/contracts/src/models.ts (ModelType/ModelProvider)
    - packages/contracts/src/knowledge-bases.ts (KnowledgeBase + status enum)
    - packages/contracts/src/documents.ts (Document + status/type enums)
    - packages/contracts/src/chunks.ts (Chunk)
    - packages/contracts/src/retrieval.ts (RetrievalTestRequest/Hit/Response)
    - packages/contracts/src/agents.ts (Agent + status enum)
    - packages/contracts/src/prompts.ts (Prompt + PromptVersion + node/status enums)
    - packages/contracts/src/chat.ts (ChatRequest + ChatStreamEvent discriminatedUnion: token/citation/done/error)
    - packages/contracts/src/conversations.ts (Conversation + Message + role enum)
    - packages/contracts/src/evalsets.ts (EvalSet)
    - packages/contracts/src/evals.ts (EvalRun + EvalMetric + EvalCaseResult)
    - packages/contracts/src/pagination.ts (PaginatedResponseSchema generic factory)
    - packages/contracts/src/index.ts (barrel: +12 re-exports)
    - packages/contracts/src/m2-schemas.test.ts (NEW: 31 tests, positive+negative+union+generic)
  Produces: 12 contract schema files; clean numeric/enum field types (prototype display strings → numbers/enums, mapped in Story 5); ChatStreamEvent as discriminatedUnion; generic PaginatedResponseSchema factory
  Tests: contracts 41 tests green (31 new); full repo 8/8 tasks green; lint 0; contracts build ok
  Design notes:
    - Schemas use clean API field names (docsCount/chunksCount/topK/threshold as numbers); Story 5 mock data will adapt prototype display strings ("86"/"3,412"/"0.20") to these.
    - Excluded UI-only fields (tag/color) from contracts — frontend maps status→color.
    - evals metrics/cases keep display strings (matches prototype REPORTS); M11 will refine.
  Concerns: none

Story 3: "后端 10 个 skeleton 模块" — complete (no individual review — non-security; covered by final review)
  Commits: 0fff948
  Contracts additions (request DTOs, 单一来源):
    - packages/contracts/src/models.ts (+CreateModelRequestSchema = omit id)
    - packages/contracts/src/knowledge-bases.ts (+CreateKnowledgeBaseRequestSchema = omit id/counts/status/updatedAt)
    - packages/contracts/src/documents.ts (+CreateDocumentRequestSchema, +IngestionStatusSchema)
    - packages/contracts/src/chunks.ts (+UpdateChunkEnabledRequestSchema)
    - packages/contracts/src/agents.ts (+CreateAgentRequestSchema omit id, +UpdateAgentRequestSchema = partial)
    - packages/contracts/src/prompts.ts (+PromptListResponseSchema, +PromptVersionListResponseSchema, +CreatePromptVersionRequestSchema omit id/promptId/version/status — 后端分配 version+status)
    - packages/contracts/src/m2-schemas.test.ts (+8 request-schema tests)
  Backend modules (NEW, each module/controller/service):
    - apps/backend/src/modules/models/        (GET / GET/:id POST / POST/:id/test)
    - apps/backend/src/modules/knowledge-bases/ (GET / GET/:id POST /)
    - apps/backend/src/modules/documents/      (GET /?kbId= GET/:id POST / →202)
    - apps/backend/src/modules/ingestion/      (@Controller("documents/:id"): POST /ingest→202, GET /ingestion-status)
    - apps/backend/src/modules/chunks/         (GET /:docId PATCH /:id toggle)
    - apps/backend/src/modules/retrieval/      (POST /test)
    - apps/backend/src/modules/agents/         (GET / GET/:id POST / PATCH /:id)
    - apps/backend/src/modules/prompts/        (GET / GET/:id GET/:id/versions POST /:id/versions)
    - apps/backend/src/modules/chat/           (POST / → text/event-stream mock; @Res 手写 SSE, SseResponse 结构类型避免 @types/express)
    - apps/backend/src/modules/conversations/  (GET / GET/:id GET/:id/messages)
  Modified:
    - apps/backend/src/app.module.ts (imports +10 modules)
    - eslint.config.mjs (+@typescript-eslint/no-unused-vars argsIgnorePattern "^_" for stub params; 放在 recommended 之后覆盖; 边界规则不动)
  Test (NEW): apps/backend/test/skeleton.e2e.spec.ts (24 tests: auth guard 401, 每域 GET/POST schema 合规, AC10 agents 非法 body→400, AC9 chat SSE 事件 ChatStreamEventSchema parse, AC4 OpenAPI paths 含全部新域端点)
  Produces: 10 域 skeleton 端点（mock/空态，JWT 保护，全局 ZodValidationPipe 生效）；OpenAPI /api/docs-json 含全部新域路径；chat mock SSE 流（token×N → citation → done）
  Tests: backend 13 suites / 60 tests green (24 new skeleton); contracts 49 tests green (8 new); full repo 8/8 tasks green; lint 0; build ok
  Design notes:
    - 请求 DTO 一律在 contracts（单一来源）；create schema 用 entity.omit({id, ...后端分配字段})
    - prompts create 版本：version/status 由后端分配（新建一律 draft），客户端只发 body/variables/note/author
    - chat SSE 用 @Res() 手写（非 @Sse()）：POST + 显式 header 控制，便于 e2e 断言；M8 改 AsyncGenerator
    - SseResponse 结构类型兼容 Express Response，避免引入 @types/express 依赖
    - ingestion 单独成模块（@Controller("documents/:id")）：异步管线关注点，M4 独立扩展
  Concerns:
    - zod-pipe.e2e.spec.ts 在并行全量跑时偶发 404（POST /api/auth/login 路由未就绪），单跑/ --runInBand 稳定通过。非本 story 引入（auth 未改动），疑似 NestJS TestingModule + supertest 在并行 worker 下的初始化竞态。若 CI 复现需单独排查（jest maxWorkers 或 beforeAll 路由就绪等待）。
