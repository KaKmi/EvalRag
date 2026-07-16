import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import { EvalSetsService } from "../src/modules/eval-runs/eval-sets.service";
import type {
  EvalCaseVersionContent,
  EvalSetAggregate,
  NewEvalCaseInput,
  NewEvalSetInput,
} from "../src/modules/eval-runs/eval-sets.repository";
import type { EvalCaseRow, EvalCaseVersionRow, EvalSetRow } from "../src/modules/eval-runs/schema";

// 仓库既有 spec 的 fake-repo 风格：手写内存实现，不引 DB。
// 参照 apps/backend/test/applications.service.spec.ts:61 的 `function service(overrides = {})` 工厂。
const now = new Date("2026-07-16T00:00:00.000Z");

interface CaseFixture {
  id: string;
  setId: string;
  status?: "draft" | "reviewed";
  version?: number;
  question?: string;
  goldPoints?: string[];
  goldDocIds?: string[];
  tags?: string[];
  goldStale?: boolean;
}

function makeSet(id: string, name: string): EvalSetRow {
  return {
    id,
    name,
    description: "",
    kbIds: [],
    createdBy: "admin",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function setup(opts: { existingNames?: string[]; cases?: CaseFixture[] } = {}) {
  // 默认种一个 s1：createCase / importCases 会先查评测集存在性。
  const sets: EvalSetRow[] = [makeSet("s1", "默认集")];
  (opts.existingNames ?? []).forEach((name, i) => sets.push(makeSet(`s-existing-${i}`, name)));

  const cases: EvalCaseRow[] = [];
  const versions: EvalCaseVersionRow[] = [];
  for (const fixture of opts.cases ?? []) {
    const version = fixture.version ?? 1;
    cases.push({
      id: fixture.id,
      setId: fixture.setId,
      status: fixture.status ?? "draft",
      currentVersion: version,
      goldStale: fixture.goldStale ?? false,
      sourceTraceId: null,
      createdAt: now,
      deletedAt: null,
    });
    versions.push({
      id: `${fixture.id}-v${version}`,
      caseId: fixture.id,
      version,
      question: fixture.question ?? "原问题",
      goldPoints: fixture.goldPoints ?? ["原要点"],
      goldDocIds: fixture.goldDocIds ?? [],
      tags: fixture.tags ?? [],
      createdAt: now,
    });
  }

  const live = (setId: string) => cases.filter((c) => c.setId === setId && c.deletedAt === null);
  const currentVersionOf = (row: EvalCaseRow) =>
    versions.find((v) => v.caseId === row.id && v.version === row.currentVersion);
  let nextId = 0;
  const newId = (prefix: string) => `${prefix}-${++nextId}`;

  const repo = {
    async findSetById(id: string): Promise<EvalSetRow | undefined> {
      return sets.find((s) => s.id === id && s.deletedAt === null);
    },
    async findSetByName(name: string): Promise<EvalSetRow | undefined> {
      return sets.find((s) => s.deletedAt === null && s.name.toLowerCase() === name.toLowerCase());
    },
    async listAggregates(setId?: string): Promise<EvalSetAggregate[]> {
      return sets
        .filter((s) => s.deletedAt === null && (setId === undefined || s.id === setId))
        .map((s) => ({
          ...s,
          caseCount: live(s.id).length,
          reviewedCaseCount: live(s.id).filter((c) => c.status === "reviewed").length,
          withGoldDocs: live(s.id).filter((c) => (currentVersionOf(c)?.goldDocIds ?? []).length > 0)
            .length,
          lastRunScore: null,
        }));
    },
    async insertSet(input: NewEvalSetInput): Promise<EvalSetRow> {
      const row: EvalSetRow = {
        id: newId("s"),
        name: input.name,
        description: input.description,
        kbIds: input.kbIds,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      sets.push(row);
      return row;
    },
    async updateSet(id: string, patch: Partial<EvalSetRow>): Promise<EvalSetRow | undefined> {
      const row = sets.find((s) => s.id === id && s.deletedAt === null);
      if (!row) return undefined;
      Object.assign(row, patch, { updatedAt: now });
      return row;
    },
    async softDeleteSet(id: string): Promise<boolean> {
      const row = sets.find((s) => s.id === id && s.deletedAt === null);
      if (!row) return false;
      row.deletedAt = now;
      return true;
    },
    async listCases(setId: string) {
      return live(setId).map((row) => ({ case: row, version: currentVersionOf(row)! }));
    },
    async findCase(setId: string, caseId: string) {
      const row = live(setId).find((c) => c.id === caseId);
      return row ? { case: row, version: currentVersionOf(row)! } : undefined;
    },
    async insertCaseWithVersion(input: NewEvalCaseInput) {
      const row: EvalCaseRow = {
        id: newId("c"),
        setId: input.setId,
        status: "draft",
        currentVersion: 1,
        goldStale: false,
        sourceTraceId: input.sourceTraceId ?? null,
        createdAt: now,
        deletedAt: null,
      };
      const version: EvalCaseVersionRow = {
        id: `${row.id}-v1`,
        caseId: row.id,
        version: 1,
        ...input.content,
        createdAt: now,
      };
      cases.push(row);
      versions.push(version);
      return { case: row, version };
    },
    async appendCaseVersion(caseId: string, version: number, content: EvalCaseVersionContent) {
      const row: EvalCaseVersionRow = {
        id: `${caseId}-v${version}`,
        caseId,
        version,
        ...content,
        createdAt: now,
      };
      versions.push(row);
      return row;
    },
    async updateCase(caseId: string, patch: Partial<EvalCaseRow>): Promise<EvalCaseRow> {
      const row = cases.find((c) => c.id === caseId);
      if (!row) throw new Error(`case ${caseId} missing`);
      Object.assign(row, patch);
      return row;
    },
    async softDeleteCase(setId: string, caseId: string): Promise<boolean> {
      const row = live(setId).find((c) => c.id === caseId);
      if (!row) return false;
      row.deletedAt = now;
      return true;
    },
    async listReviewedCaseVersions(setId: string) {
      return live(setId)
        .filter((c) => c.status === "reviewed")
        .map((c, index) => {
          const version = currentVersionOf(c)!;
          return {
            caseId: c.id,
            caseVersionId: version.id,
            question: version.question,
            goldPoints: version.goldPoints,
            seq: index + 1,
          };
        });
    },
  };

  return { service: new EvalSetsService(repo as never), sets, cases, versions, repo };
}

describe("EvalSetsService", () => {
  it("create：名称查重命中 → ConflictException「名称已存在」", async () => {
    const { service } = setup({ existingNames: ["售后核心 50 题"] });
    await expect(
      service.create({ name: "售后核心 50 题", kbIds: [] }, "admin"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("createCase：无 gold 要点可建，落 draft", async () => {
    const { service } = setup();
    const created = await service.createCase(
      "s1",
      { question: "退款吗", goldPoints: [], goldDocIds: [], tags: [] },
      "admin",
    );
    expect(created.status).toBe("draft");
    expect(created.version).toBe(1);
  });

  it("updateCase：改内容 → 新版本 v+1，旧版本保留，status 不变", async () => {
    const { service, versions } = setup({
      cases: [{ id: "c1", setId: "s1", status: "reviewed", version: 1 }],
    });
    const updated = await service.updateCase("s1", "c1", { question: "改过的问题" });
    expect(updated.version).toBe(2);
    expect(updated.status).toBe("reviewed"); // 原型 §18.B：reviewed 编辑后仍 reviewed
    expect(versions.filter((v) => v.caseId === "c1")).toHaveLength(2); // 旧版本冻结
  });

  it("updateCase：draft → reviewed 但 gold 要点为空 → 422「至少填写 1 个答案要点」", async () => {
    const { service } = setup({
      cases: [{ id: "c1", setId: "s1", status: "draft", version: 1, goldPoints: [] }],
    });
    await expect(service.updateCase("s1", "c1", { status: "reviewed" })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it("update：只改传了的字段——省略 kbIds 不清空（PATCH 语义，contracts eval-sets.ts:20-30）", async () => {
    const { service, sets } = setup();
    sets[0].kbIds = ["8f14e45f-ceea-467a-9e2b-1b1f1e1a1a1a"];
    sets[0].description = "原描述";
    const updated = await service.update("s1", { name: "改名了" });
    expect(updated.name).toBe("改名了");
    expect(updated.kbIds).toEqual(["8f14e45f-ceea-467a-9e2b-1b1f1e1a1a1a"]); // 一次纯改名不得清空关联知识库
    expect(updated.description).toBe("原描述");
  });

  it("list：gold docs 分母 = 用例总数（含待审），不是已审数", async () => {
    // 原型 §5「高频 Badcase 集」：用例=34 且全待审，gold docs 仍显示 0/34（不是 0/0）。
    const { service } = setup({
      cases: [
        { id: "c1", setId: "s1", status: "draft", goldDocIds: [] },
        {
          id: "c2",
          setId: "s1",
          status: "draft",
          goldDocIds: ["b1a7f0de-0000-4000-8000-000000000001"],
        },
      ],
    });
    const [set] = await service.list();
    expect(set.reviewedCaseCount).toBe(0);
    expect(set.goldDocCoverage).toEqual({ withGoldDocs: 1, total: 2 });
  });

  it("updateCase：改内容且同时转 reviewed 但 gold 为空 → 422，且不落孤儿版本", async () => {
    // 守卫必须先于写入：否则先追加 v2 再抛 422，留下 currentVersion 没跟上的孤儿版本行。
    const { service, versions, cases } = setup({
      cases: [{ id: "c1", setId: "s1", status: "draft", version: 1, goldPoints: [] }],
    });
    await expect(
      service.updateCase("s1", "c1", { question: "改过的问题", status: "reviewed" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(versions.filter((v) => v.caseId === "c1")).toHaveLength(1);
    expect(cases[0].currentVersion).toBe(1);
    expect(cases[0].status).toBe("draft");
  });

  it("updateCase：编辑产生新版本 → 自动清 gold-stale 标志（原型 §18.B）", async () => {
    const { service, cases } = setup({
      cases: [{ id: "c1", setId: "s1", status: "reviewed", version: 1, goldStale: true }],
    });
    const updated = await service.updateCase("s1", "c1", { question: "改过的问题" });
    expect(updated.goldStale).toBe(false);
    expect(cases[0].goldStale).toBe(false);
  });

  it("updateCase：新版本是全量快照——未传的内容字段沿用旧版本，不丢数据", async () => {
    const { service } = setup({
      cases: [
        {
          id: "c1",
          setId: "s1",
          status: "reviewed",
          version: 1,
          goldPoints: ["要点A"],
          tags: ["退款"],
        },
      ],
    });
    const updated = await service.updateCase("s1", "c1", { question: "只改问题" });
    expect(updated.question).toBe("只改问题");
    expect(updated.goldPoints).toEqual(["要点A"]);
    expect(updated.tags).toEqual(["退款"]);
  });

  it("updateCase：纯改状态（draft→reviewed，gold ≥1）不产生新版本", async () => {
    const { service, versions } = setup({
      cases: [{ id: "c1", setId: "s1", status: "draft", version: 1, goldPoints: ["要点A"] }],
    });
    const updated = await service.updateCase("s1", "c1", { status: "reviewed" });
    expect(updated.status).toBe("reviewed");
    expect(updated.version).toBe(1);
    expect(versions.filter((v) => v.caseId === "c1")).toHaveLength(1);
  });

  it("remove：软删后同名可复用（对齐 lower(name) WHERE deleted_at IS NULL 部分唯一索引）", async () => {
    const { service } = setup();
    await service.remove("s1");
    const created = await service.create({ name: "默认集", kbIds: [] }, "admin");
    expect(created.name).toBe("默认集");
  });

  it("importCases：逐行校验，缺 goldAnswer 的行进 errors，其余照常导入且为 draft", async () => {
    const { service } = setup();
    const res = await service.importCases(
      "s1",
      [
        { question: "q1", goldAnswer: "a1" },
        { question: "q2", goldAnswer: "" },
      ],
      "admin",
    );
    expect(res.imported).toBe(1);
    expect(res.errors).toEqual([{ row: 2, message: "第 2 行缺少 gold_answer" }]);
  });

  it("importCases：纯分隔符的 gold_answer 视同缺失，不落永远无法审核的僵尸用例", async () => {
    const { service, cases } = setup();
    const res = await service.importCases("s1", [{ question: "q1", goldAnswer: "；;" }], "admin");
    expect(res.imported).toBe(0);
    expect(res.errors).toEqual([{ row: 1, message: "第 1 行缺少 gold_answer" }]);
    expect(cases).toHaveLength(0);
  });
});
