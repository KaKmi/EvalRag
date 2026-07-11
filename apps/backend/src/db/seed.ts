import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { compilePromptBody, extractVars, NODE_CONTRACT_VERSION } from "@codecrush/contracts";
import type { PromptNode } from "@codecrush/contracts";
import { users } from "../modules/users/schema";
import { hashPassword } from "../modules/users/password";
import { normalizeEmail } from "../modules/users/users.service";
import { prompts, promptVersions, promptVersionTags } from "../modules/prompts/schema";

const DEMO_EMAIL = normalizeEmail(process.env.DEMO_USER_EMAIL ?? "demo@codecrush.local");
const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD ?? "CodeCrushDemo123!";
const DEMO_DISPLAY_NAME = process.env.DEMO_USER_DISPLAY_NAME ?? "Demo Admin";

const SEED_AUTHOR = "system@codecrush.local";

// D9：4 默认 Prompt（各 v1 + production 标签，保 demo 连续性）。
// 012：标签只是记账信号，不产生上线语义；body 字段对齐 NODE_CONTRACTS 权威字段表。
const DEFAULT_PROMPTS: ReadonlyArray<{ name: string; node: PromptNode; body: string }> = [
  {
    name: "问题改写-通用",
    node: "rewrite",
    body: "你是一个问题改写器，请将用户问题改写为更利于检索的形式。问题：{query}",
  },
  {
    name: "意图识别-通用",
    node: "intent",
    body: "请识别用户意图，输出意图标签。问题：{query}",
  },
  {
    name: "回复生成-通用",
    node: "reply",
    body: "基于以下检索结果回答用户问题。问题：{query}\n上下文：{retrievalContext}",
  },
  {
    name: "兜底回复-通用",
    node: "fallback",
    body: "抱歉，未找到相关信息，已转人工。",
  },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await db
    .insert(users)
    .values({ email: DEMO_EMAIL, displayName: DEMO_DISPLAY_NAME, passwordHash })
    .onConflictDoNothing({ target: users.email });

  for (const dp of DEFAULT_PROMPTS) {
    const [prompt] = await db
      .insert(prompts)
      .values({ name: dp.name, node: dp.node, updatedBy: SEED_AUTHOR })
      .onConflictDoNothing({ target: prompts.name })
      .returning();
    if (!prompt) continue; // 已存在则跳过，不重复 seed version
    const compiled = compilePromptBody(dp.body, dp.node);
    const [version] = await db
      .insert(promptVersions)
      .values({
        promptId: prompt.id,
        version: 1,
        body: dp.body,
        variables: extractVars(dp.body),
        contractVersion: NODE_CONTRACT_VERSION,
        compileStatus: compiled.status,
        compileErrors: compiled.issues,
        author: SEED_AUTHOR,
      })
      .returning();
    await db.insert(promptVersionTags).values({
      promptId: prompt.id,
      promptVersionId: version.id,
      name: "production",
      createdBy: SEED_AUTHOR,
    });
  }

  await pool.end();
  console.log(`demo user ensured: ${DEMO_EMAIL}`);
  console.log(`default prompts ensured: ${DEFAULT_PROMPTS.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
