# Dev Ledger — m0-engineering-foundation

Story 0: "仓库与 workspace 根" — complete
  Commits: 51d2540
  Files: .nvmrc, .gitignore, package.json, pnpm-workspace.yaml, turbo.json, pnpm-lock.yaml (+ 基线 docs/原型/.ship)
  Produces: pnpm workspace(apps/*, packages/*); root scripts dev/build/test/lint/format/db:*; turbo tasks(build/test/dev)
  Concerns: 初始提交含既有 docs/原型作为基线（无害）；实装版本比 plan 新（eslint 10 / typescript 6 / turbo 2.10），兼容

Story 1: "根 tooling (tsconfig/eslint/prettier)" — complete
  Commits: ced0cbd
  Files: tsconfig.base.json, .prettierrc, eslint.config.mjs
  Produces: 共享 tsconfig base; eslint flat(typescript-eslint recommended + no-restricted-imports 两条边界 + files:.ts/.tsx); prettier
  Concerns: 此刻仓库无 .ts 源码，`eslint .` 报"全被忽略"退 2（配置本身解析正常）；有源码后即正常，Story 2/6 验证

Story 2: "packages/contracts" — complete
  Commits: d9283c2
  Files: packages/contracts/{package.json,tsconfig.json,src/{index,health,otel,health.test}.ts}
  Produces: @codecrush/contracts → HealthResponseSchema/HealthResponse; GEN_AI/RAG OTLP 常量。CJS 产物 dist/。
  Verified: build 0 / lint 0 / test 0（2/2）
  Concerns: 实装 zod 4 / TS 6 / vitest 4（比 plan 新）；tsconfig 加 ignoreDeprecations "6.0" 静默 node10 弃用（TS7 前需迁移 nodenext，已记 revisit）
