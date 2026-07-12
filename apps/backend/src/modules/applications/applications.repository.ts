import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { DRIZZLE } from "../../platform/persistence/drizzle.constants";
import type { DB } from "../../platform/persistence/persistence.module";
import {
  applicationConfigVersionKbs,
  applicationConfigVersionTags,
  applicationConfigVersions,
  applications,
  type ApplicationConfigVersionRow,
  type ApplicationRow,
  type NewApplication,
  type NewApplicationConfigVersion,
} from "./schema";

export type ApplicationListRow = ApplicationRow & {
  productionVersion: number | null;
  latestVersion: number;
  versionCount: number;
};

const APP_SELECT = {
  id: applications.id,
  slug: applications.slug,
  name: applications.name,
  description: applications.description,
  enabled: applications.enabled,
  productionConfigVersionId: applications.productionConfigVersionId,
  createdBy: applications.createdBy,
  updatedBy: applications.updatedBy,
  createdAt: applications.createdAt,
  updatedAt: applications.updatedAt,
  deletedAt: applications.deletedAt,
  productionVersion: sql<
    number | null
  >`(SELECT version FROM application_config_versions WHERE id = "applications"."production_config_version_id")`.as(
    "production_version",
  ),
  latestVersion:
    sql<number>`COALESCE((SELECT max(version) FROM application_config_versions WHERE application_id = "applications"."id"), 1)`.as(
      "latest_version",
    ),
  versionCount:
    sql<number>`COALESCE((SELECT count(*)::int FROM application_config_versions WHERE application_id = "applications"."id"), 1)`.as(
      "version_count",
    ),
} as const;

@Injectable()
export class ApplicationsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DB) {}

  async findApplications(): Promise<ApplicationListRow[]> {
    return this.db.select(APP_SELECT).from(applications).orderBy(desc(applications.updatedAt));
  }
  async findApplicationById(id: string): Promise<ApplicationListRow | undefined> {
    return (
      await this.db.select(APP_SELECT).from(applications).where(eq(applications.id, id)).limit(1)
    )[0];
  }
  async findBySlug(slug: string): Promise<ApplicationRow | undefined> {
    return (
      await this.db.select().from(applications).where(eq(applications.slug, slug)).limit(1)
    )[0];
  }
  async findByName(name: string): Promise<ApplicationRow | undefined> {
    return (
      await this.db.select().from(applications).where(eq(applications.name, name)).limit(1)
    )[0];
  }
  async findVersions(applicationId: string): Promise<ApplicationConfigVersionRow[]> {
    return this.db
      .select()
      .from(applicationConfigVersions)
      .where(eq(applicationConfigVersions.applicationId, applicationId))
      .orderBy(desc(applicationConfigVersions.version));
  }
  async findVersionById(id: string): Promise<ApplicationConfigVersionRow | undefined> {
    return (
      await this.db
        .select()
        .from(applicationConfigVersions)
        .where(eq(applicationConfigVersions.id, id))
        .limit(1)
    )[0];
  }
  async findVersionKbIds(id: string): Promise<string[]> {
    return (
      await this.db
        .select({ kbId: applicationConfigVersionKbs.kbId })
        .from(applicationConfigVersionKbs)
        .where(eq(applicationConfigVersionKbs.configVersionId, id))
    ).map((r) => r.kbId);
  }
  async findKbIdsByVersionIds(ids: string[]): Promise<Map<string, string[]>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        versionId: applicationConfigVersionKbs.configVersionId,
        kbId: applicationConfigVersionKbs.kbId,
      })
      .from(applicationConfigVersionKbs)
      .where(inArray(applicationConfigVersionKbs.configVersionId, ids));
    const result = new Map<string, string[]>();
    for (const row of rows)
      result.set(row.versionId, [...(result.get(row.versionId) ?? []), row.kbId]);
    return result;
  }
  async createApplicationWithV1(
    app: NewApplication,
    version: Omit<NewApplicationConfigVersion, "applicationId">,
    kbIds: string[],
  ) {
    return this.db.transaction(async (tx) => {
      const [application] = await tx.insert(applications).values(app).returning();
      const [createdVersion] = await tx
        .insert(applicationConfigVersions)
        .values({ ...version, applicationId: application.id })
        .returning();
      await tx
        .insert(applicationConfigVersionKbs)
        .values(kbIds.map((kbId) => ({ configVersionId: createdVersion.id, kbId })));
      return { application, version: createdVersion };
    });
  }
  async insertVersion(row: NewApplicationConfigVersion, kbIds: string[], actor: string) {
    return this.db.transaction(async (tx) => {
      const [version] = await tx.insert(applicationConfigVersions).values(row).returning();
      await tx
        .insert(applicationConfigVersionKbs)
        .values(kbIds.map((kbId) => ({ configVersionId: version.id, kbId })));
      await tx
        .update(applications)
        .set({ updatedBy: actor, updatedAt: new Date() })
        .where(eq(applications.id, row.applicationId));
      return version;
    });
  }
  async updateBase(
    id: string,
    patch: Partial<Pick<NewApplication, "name" | "description" | "enabled" | "updatedBy">>,
  ) {
    return (
      await this.db
        .update(applications)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(applications.id, id))
        .returning()
    )[0];
  }
  async deleteApplication(id: string): Promise<number> {
    return (
      await this.db
        .delete(applications)
        .where(eq(applications.id, id))
        .returning({ id: applications.id })
    ).length;
  }
  async findPromptUsage(promptVersionIds: string[]) {
    if (promptVersionIds.length === 0) return [];
    const ids = sql`ARRAY[${sql.join(
      promptVersionIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[]`;
    const result = await this.db.execute(sql`
      SELECT a.id application_id, a.name application_name, v.version config_version,
        CASE WHEN v.prompt_rewrite_version_id = ANY(${ids}) THEN 'rewrite'
             WHEN v.prompt_intent_version_id = ANY(${ids}) THEN 'intent'
             WHEN v.prompt_reply_version_id = ANY(${ids}) THEN 'reply'
             ELSE 'fallback' END node,
        CASE WHEN v.prompt_rewrite_version_id = ANY(${ids}) THEN v.prompt_rewrite_version_id
             WHEN v.prompt_intent_version_id = ANY(${ids}) THEN v.prompt_intent_version_id
             WHEN v.prompt_reply_version_id = ANY(${ids}) THEN v.prompt_reply_version_id
             ELSE v.prompt_fallback_version_id END prompt_version_id
      FROM applications a JOIN application_config_versions v ON v.id = a.production_config_version_id
      WHERE v.prompt_rewrite_version_id = ANY(${ids}) OR v.prompt_intent_version_id = ANY(${ids}) OR v.prompt_reply_version_id = ANY(${ids}) OR v.prompt_fallback_version_id = ANY(${ids})
    `);
    return result.rows as {
      application_id: string;
      application_name: string;
      config_version: number;
      node: string;
      prompt_version_id: string;
    }[];
  }

  // —— M7b 自定义命名标签（照抄 012 prompt_version_tags 范式，归属 applications 域）——

  /** 批量取多应用的标签名（列表「标识」列，一次查询防 N+1） */
  async findTagNamesByAppIds(appIds: string[]): Promise<Map<string, string[]>> {
    if (appIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        applicationId: applicationConfigVersionTags.applicationId,
        name: applicationConfigVersionTags.name,
      })
      .from(applicationConfigVersionTags)
      .where(inArray(applicationConfigVersionTags.applicationId, appIds))
      .orderBy(asc(applicationConfigVersionTags.name));
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.applicationId, [...(map.get(r.applicationId) ?? []), r.name]);
    return map;
  }

  /** 标签 + 所指版本号（PUT/GET tags 响应形状、「管理标识」弹窗） */
  async findTagsWithVersion(
    appId: string,
  ): Promise<{ name: string; versionId: string; version: number }[]> {
    return this.db
      .select({
        name: applicationConfigVersionTags.name,
        versionId: applicationConfigVersionTags.configVersionId,
        version: applicationConfigVersions.version,
      })
      .from(applicationConfigVersionTags)
      .innerJoin(
        applicationConfigVersions,
        eq(applicationConfigVersionTags.configVersionId, applicationConfigVersions.id),
      )
      .where(eq(applicationConfigVersionTags.applicationId, appId))
      .orderBy(asc(applicationConfigVersionTags.name));
  }

  // 排他移动：一条原子 UPSERT，冲突目标是 (application_id, lower(name)) 表达式唯一索引。
  // 并发移动在行锁上天然串行；跨应用版本被复合 FK 直接 23503 拒绝（service 转 404）。
  async upsertTag(appId: string, versionId: string, name: string, actor: string): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO ${applicationConfigVersionTags} (application_id, config_version_id, name, created_by)
      VALUES (${appId}, ${versionId}, ${name}, ${actor})
      ON CONFLICT (application_id, lower(name))
      DO UPDATE SET config_version_id = excluded.config_version_id,
                    created_at = now(),
                    created_by = excluded.created_by
    `);
  }

  /** 摘除标签；返回删除行数（0 = 标签不存在）。name 已在 service 边界归一小写。 */
  async deleteTag(appId: string, name: string): Promise<number> {
    const rows = await this.db
      .delete(applicationConfigVersionTags)
      .where(
        and(
          eq(applicationConfigVersionTags.applicationId, appId),
          eq(applicationConfigVersionTags.name, name),
        ),
      )
      .returning({ id: applicationConfigVersionTags.id });
    return rows.length;
  }

  async countTags(appId: string): Promise<number> {
    const rows = await this.db
      .select({ c: count() })
      .from(applicationConfigVersionTags)
      .where(eq(applicationConfigVersionTags.applicationId, appId));
    return rows[0]?.c ?? 0;
  }

  /** cap 校验只对新名放行：已存在同名（大小写不敏感）= 移动，不占额度 */
  async tagExists(appId: string, lowerName: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: applicationConfigVersionTags.id })
      .from(applicationConfigVersionTags)
      .where(
        and(
          eq(applicationConfigVersionTags.applicationId, appId),
          sql`lower(${applicationConfigVersionTags.name}) = ${lowerName}`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
