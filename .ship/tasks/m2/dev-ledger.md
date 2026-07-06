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
  Commits: <to fill>
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
