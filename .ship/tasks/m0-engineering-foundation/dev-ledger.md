# Dev Ledger — m0-engineering-foundation

Story 0: "仓库与 workspace 根" — complete
  Commits: 51d2540
  Files: .nvmrc, .gitignore, package.json, pnpm-workspace.yaml, turbo.json, pnpm-lock.yaml (+ 基线 docs/原型/.ship)
  Produces: pnpm workspace(apps/*, packages/*); root scripts dev/build/test/lint/format/db:*; turbo tasks(build/test/dev)
  Concerns: 初始提交含既有 docs/原型作为基线（无害）；实装版本比 plan 新（eslint 10 / typescript 6 / turbo 2.10），兼容
