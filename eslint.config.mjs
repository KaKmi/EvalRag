import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "apps/backend/drizzle/**",
      "**/*.config.*",
    ],
  },
  // 让 ESLint flat config 处理 .ts/.tsx（默认只处理 .js/.mjs/.cjs）
  { files: ["**/*.{ts,tsx}"] },
  ...tseslint.configs.recommended,
  // Boundary ①：frontend 不得 import backend（仅可用 @codecrush/contracts）
  {
    files: ["apps/frontend/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@codecrush/backend", "@codecrush/backend/*"],
              message: "frontend 只能用 @codecrush/contracts，不得 import backend",
            },
          ],
        },
      ],
    },
  },
  // Boundary ②：contracts 是地基，不得依赖任何 app
  {
    files: ["packages/contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@codecrush/backend", "@codecrush/frontend"],
              message: "contracts 是地基，不得依赖 apps",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
