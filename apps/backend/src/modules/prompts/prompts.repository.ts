import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DRIZZLE } from "../../platform/persistence/drizzle.constants";
import type { DB } from "../../platform/persistence/persistence.module";
import {
  prompts,
  promptVersions,
  type NewPrompt,
  type NewPromptVersion,
  type PromptRow,
  type PromptVersionRow,
} from "./schema";

@Injectable()
export class PromptsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DB) {}

  async findPrompts(): Promise<PromptRow[]> {
    return await this.db.select().from(prompts);
  }

  async findPromptById(id: string): Promise<PromptRow | undefined> {
    const rows = await this.db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
    return rows[0];
  }

  async insertPrompt(row: NewPrompt): Promise<PromptRow> {
    const rows = await this.db.insert(prompts).values(row).returning();
    return rows[0];
  }

  async findVersions(promptId: string): Promise<PromptVersionRow[]> {
    return await this.db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.promptId, promptId));
  }

  async findVersionById(versionId: string): Promise<PromptVersionRow | undefined> {
    const rows = await this.db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.id, versionId))
      .limit(1);
    return rows[0];
  }

  async insertVersion(row: NewPromptVersion): Promise<PromptVersionRow> {
    const rows = await this.db.insert(promptVersions).values(row).returning();
    return rows[0];
  }

  async findProdVersion(promptId: string): Promise<PromptVersionRow | undefined> {
    const rows = await this.db
      .select()
      .from(promptVersions)
      .where(
        and(eq(promptVersions.promptId, promptId), eq(promptVersions.status, "prod")),
      )
      .limit(1);
    return rows[0];
  }

  // 发布/回滚事务（D2）：archive 旧 prod → set 新 prod → 更新 prompt.currentVersionId/updatedBy/updatedAt（D16）
  async publishVersion(
    promptId: string,
    versionId: string,
    actorEmail: string,
  ): Promise<PromptVersionRow> {
    return await this.db.transaction(async (tx) => {
      await tx
        .update(promptVersions)
        .set({ status: "archived" })
        .where(
          and(eq(promptVersions.promptId, promptId), eq(promptVersions.status, "prod")),
        );
      await tx
        .update(promptVersions)
        .set({ status: "prod" })
        .where(eq(promptVersions.id, versionId));
      await tx
        .update(prompts)
        .set({ currentVersionId: versionId, updatedBy: actorEmail, updatedAt: new Date() })
        .where(eq(prompts.id, promptId));
      const rows = await tx
        .select()
        .from(promptVersions)
        .where(eq(promptVersions.id, versionId))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error(`publishVersion: version ${versionId} vanished after update`);
      return row;
    });
  }
}
