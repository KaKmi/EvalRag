import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DRIZZLE } from "../../platform/persistence/drizzle.constants";
import type { DB } from "../../platform/persistence/persistence.module";
import {
  agents,
  agentConfigVersions,
  agentConfigVersionKbs,
  type AgentRow,
  type NewAgent,
  type AgentConfigVersionRow,
  type NewAgentConfigVersion,
} from "./schema";

// list/get 聚合行：当前生产版本的关键摘要字段一次拿全，避免 N+1（参照 prompts.repository.ts PROMPT_AGG_SELECT）
export type AgentListRow = AgentRow & {
  currentVersionNumber: number | null;
  currentVersionStatus: string | null;
};

const AGENT_AGG_SELECT = {
  id: agents.id,
  name: agents.name,
  desc: agents.desc,
  enabled: agents.enabled,
  currentVersionId: agents.currentVersionId,
  createdAt: agents.createdAt,
  updatedAt: agents.updatedAt,
  updatedBy: agents.updatedBy,
  // 相关子查询里外层引用必须显式限定为 "agents"."x"（同 prompts.repository.ts 的注释教训）
  currentVersionNumber: sql<number | null>`(
    SELECT ${agentConfigVersions.version} FROM ${agentConfigVersions}
    WHERE ${agentConfigVersions.id} = "agents"."current_version_id"
  )`.as("current_version_number"),
  currentVersionStatus: sql<string | null>`(
    SELECT ${agentConfigVersions.status} FROM ${agentConfigVersions}
    WHERE ${agentConfigVersions.id} = "agents"."current_version_id"
  )`.as("current_version_status"),
} as const;

@Injectable()
export class AgentsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DB) {}

  async findAgents(): Promise<AgentListRow[]> {
    return await this.db.select(AGENT_AGG_SELECT).from(agents).orderBy(desc(agents.updatedAt));
  }

  async findAgentById(id: string): Promise<AgentListRow | undefined> {
    const rows = await this.db
      .select(AGENT_AGG_SELECT)
      .from(agents)
      .where(eq(agents.id, id))
      .limit(1);
    return rows[0];
  }

  async findAgentByName(name: string): Promise<AgentRow | undefined> {
    const rows = await this.db.select().from(agents).where(eq(agents.name, name)).limit(1);
    return rows[0];
  }

  async findVersionById(versionId: string): Promise<AgentConfigVersionRow | undefined> {
    const rows = await this.db
      .select()
      .from(agentConfigVersions)
      .where(eq(agentConfigVersions.id, versionId))
      .limit(1);
    return rows[0];
  }

  async findVersions(agentId: string): Promise<AgentConfigVersionRow[]> {
    return await this.db
      .select()
      .from(agentConfigVersions)
      .where(eq(agentConfigVersions.agentId, agentId))
      .orderBy(desc(agentConfigVersions.createdAt));
  }

  async findVersionKbIds(versionId: string): Promise<string[]> {
    const rows = await this.db
      .select({ kbId: agentConfigVersionKbs.kbId })
      .from(agentConfigVersionKbs)
      .where(eq(agentConfigVersionKbs.versionId, versionId));
    return rows.map((r) => r.kbId);
  }

  // 建 Agent + v1 配置版本 + 知识库快照 + 回填指针：单事务（008 数据流程图 ①）
  async createAgentWithV1(
    agentRow: NewAgent,
    versionRow: Omit<NewAgentConfigVersion, "agentId">,
    kbIds: string[],
  ): Promise<{ agent: AgentRow; version: AgentConfigVersionRow }> {
    return await this.db.transaction(async (tx) => {
      const [agent] = await tx.insert(agents).values(agentRow).returning();
      const [version] = await tx
        .insert(agentConfigVersions)
        .values({ ...versionRow, agentId: agent.id })
        .returning();
      if (kbIds.length > 0) {
        await tx
          .insert(agentConfigVersionKbs)
          .values(kbIds.map((kbId) => ({ versionId: version.id, kbId })));
      }
      const [updatedAgent] = await tx
        .update(agents)
        .set({ currentVersionId: version.id })
        .where(eq(agents.id, agent.id))
        .returning();
      return { agent: updatedAgent, version };
    });
  }

  // 新建草稿配置版本 + 知识库快照（不动 agents 表，008 数据流程图 ②）
  async insertDraftVersion(
    versionRow: NewAgentConfigVersion,
    kbIds: string[],
  ): Promise<AgentConfigVersionRow> {
    return await this.db.transaction(async (tx) => {
      const [version] = await tx.insert(agentConfigVersions).values(versionRow).returning();
      if (kbIds.length > 0) {
        await tx
          .insert(agentConfigVersionKbs)
          .values(kbIds.map((kbId) => ({ versionId: version.id, kbId })));
      }
      return version;
    });
  }

  async updateVersionEval(
    versionId: string,
    patch: {
      evalStatus: string;
      evalRunAt: Date;
      evalPassRate: number | null;
      evalSummary: unknown;
    },
  ): Promise<AgentConfigVersionRow> {
    const rows = await this.db
      .update(agentConfigVersions)
      .set(patch)
      .where(eq(agentConfigVersions.id, versionId))
      .returning();
    return rows[0];
  }

  async updateAgentBase(
    id: string,
    patch: Partial<Pick<NewAgent, "name" | "desc" | "enabled" | "updatedBy">>,
  ): Promise<AgentRow | undefined> {
    const rows = await this.db
      .update(agents)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning();
    return rows[0];
  }

  // 发布/回滚统一事务（008 数据流程图 ③④，复刻 prompts.repository publishVersion 三步模式）
  async promote(
    agentId: string,
    versionId: string,
    actorEmail: string,
  ): Promise<AgentConfigVersionRow> {
    return await this.db.transaction(async (tx) => {
      await tx
        .update(agentConfigVersions)
        .set({ status: "archived" })
        .where(
          and(
            eq(agentConfigVersions.agentId, agentId),
            eq(agentConfigVersions.status, "published"),
          ),
        );
      await tx
        .update(agentConfigVersions)
        .set({ status: "published", publishedBy: actorEmail, publishedAt: new Date() })
        .where(eq(agentConfigVersions.id, versionId));
      await tx
        .update(agents)
        .set({ currentVersionId: versionId, updatedBy: actorEmail, updatedAt: new Date() })
        .where(eq(agents.id, agentId));
      const rows = await tx
        .select()
        .from(agentConfigVersions)
        .where(eq(agentConfigVersions.id, versionId))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error(`promote: version ${versionId} vanished after update`);
      return row;
    });
  }
}
