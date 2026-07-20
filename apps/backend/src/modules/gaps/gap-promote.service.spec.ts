import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { EvalCase } from "@codecrush/contracts";
import { GapPromoteService } from "./gap-promote.service";
import type { GapItemRow } from "./schema";
import type { GapsRepository } from "./gaps.repository";
import type { EvaluationsRepository } from "../evaluations/evaluations.repository";
import type { ModelsService } from "../models/models.service";
import type { EvalSetsService } from "../eval-runs/eval-sets.service";

/**
 * 「从坏样本生成」的服务端行为（021 §17.2、决策 G、Global Constraint 11）。
 *
 * 断言的是**产物**——落库用例的 question / goldPoints / status、簇上的标志、
 * 发给判官的 prompt 文本——不是「某个方法被调用过」。
 */

const CLUSTER = "11111111-1111-4111-8111-111111111111";
const SET = "33333333-3333-4333-8333-333333333333";
const TRACE = "a".repeat(32);

function itemRow(patch: Partial<GapItemRow> = {}): GapItemRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    clusterId: CLUSTER,
    source: "online",
    sourceTraceId: TRACE,
    question: "还有上面说的某某点需要注意什么",
    rewrittenQuestion: "管理中的授权要点需要注意什么",
    rewriteResolved: true,
    embedding: [],
    traceStartTime: null,
    faithfulness: null,
    answerRelevancy: null,
    contextPrecision: null,
    confidence: null,
    fallbackUsed: false,
    noCitations: false,
    followUpSuspected: false,
    createdAt: new Date("2026-07-18T00:00:00Z"),
    ...patch,
  } as GapItemRow;
}

interface Harness {
  service: GapPromoteService;
  /** 真正落库的用例（createCase 的产物），断言对着它，不是对着调用次数。 */
  created: EvalCase[];
  markedEnteredEvalSet: string[];
  chatCalls: { modelId: string; messages: { role: string; content: string }[] }[];
  chatReply: { value: string };
  chatError: { value: Error | null };
}

function harness(
  options: {
    items?: GapItemRow[];
    judgeModelId?: string | null;
    /** 目标集里**已经有**的用例（用于跨集去重的用例）。 */
    existingCases?: { question: string }[];
  } = {},
): Harness {
  const items = options.items ?? [itemRow()];
  const created: EvalCase[] = [];
  const markedEnteredEvalSet: string[] = [];
  const chatCalls: Harness["chatCalls"] = [];
  const chatReply = { value: JSON.stringify({ goldPoints: ["要点一", "要点二", "要点三"] }) };
  const chatError: { value: Error | null } = { value: null };

  const repo = {
    findCluster: async (id: string) =>
      id === CLUSTER ? { id: CLUSTER, deletedAt: null } : undefined,
    listItemsByIds: async (ids: string[]) => items.filter((row) => ids.includes(row.id)),
    markEnteredEvalSet: async (id: string) => {
      markedEnteredEvalSet.push(id);
    },
  } as unknown as GapsRepository;

  const evaluations = {
    getSettings: async () => ({
      judgeModelId: options.judgeModelId === undefined ? "judge-1" : options.judgeModelId,
    }),
  } as unknown as EvaluationsRepository;

  const models = {
    chat: async (modelId: string, messages: { role: string; content: string }[]) => {
      chatCalls.push({ modelId, messages });
      if (chatError.value) throw chatError.value;
      return { content: chatReply.value };
    },
  } as unknown as ModelsService;

  const evalSets = {
    /** 目标集**既有**用例——promote 会与它做归一化精确比对（防重试造整批重复）。 */
    listCases: async () => options.existingCases ?? [],
    createCase: async (
      setId: string,
      req: { question: string; goldPoints: string[]; sourceTraceId?: string },
    ) => {
      const row = {
        id: `case-${created.length + 1}`,
        setId,
        version: 1,
        // `insertCaseWithVersion` 的默认值，本服务不提供任何改它的开关（Global Constraint 11）。
        status: "draft" as const,
        question: req.question,
        goldPoints: req.goldPoints,
        goldDocRefs: [],
        tags: [],
        sourceTraceId: req.sourceTraceId ?? null,
      } as unknown as EvalCase;
      created.push(row);
      return row;
    },
  } as unknown as EvalSetsService;

  return {
    service: new GapPromoteService(repo, evaluations, models, evalSets),
    created,
    markedEnteredEvalSet,
    chatCalls,
    chatReply,
    chatError,
  };
}

const promoteReq = (items: { itemId: string; question?: string; goldPoints: string[] }[]) => ({
  clusterId: CLUSTER,
  targetSetId: SET,
  items,
});

describe("GapPromoteService.promote", () => {
  it("always creates cases with status draft (Global Constraint 11)", async () => {
    const h = harness();
    await h.service.promote(promoteReq([{ itemId: itemRow().id, goldPoints: ["要点"] }]), "a@b.c");
    expect(h.created).toHaveLength(1);
    expect(h.created.every((c) => c.status === "draft")).toBe(true);
  });

  it("still admits a row whose gold draft failed, with empty goldPoints (原型 :596)", async () => {
    const h = harness();
    const result = await h.service.promote(
      promoteReq([{ itemId: itemRow().id, goldPoints: [] }]),
      "a@b.c",
    );
    expect(result.created).toBe(1);
    expect(h.created[0].goldPoints).toEqual([]);
  });

  it("writes the REWRITTEN question into the gold case, not the raw referential one", async () => {
    const h = harness();
    await h.service.promote(promoteReq([{ itemId: itemRow().id, goldPoints: ["要点"] }]), "a@b.c");
    expect(h.created[0].question).toBe("管理中的授权要点需要注意什么");
    expect(h.created[0].question).not.toBe("还有上面说的某某点需要注意什么");
  });

  it("falls back to the original question when rewrite resolved but produced no text（首轮）", async () => {
    const h = harness({
      items: [itemRow({ question: "能开专票吗", rewrittenQuestion: null, rewriteResolved: true })],
    });
    await h.service.promote(promoteReq([{ itemId: itemRow().id, goldPoints: ["要点"] }]), "a@b.c");
    expect(h.created[0].question).toBe("能开专票吗");
  });

  it("REJECTS an unresolved-rewrite item that carries no manual rewrite（决策 G）", async () => {
    /**
     * ⚠️ 这里**必须有两条 item，且合法的排在前面**（peer review 抓出的恒绿）。
     * 只放一条未消解的，第一条就抛，`created` 天然是 0 —— 即便实现改成「边解析边写」
     * 也照样通过，那这条用例就守不住它注释里声称的「先全量解析再落库」。
     * 合法条在前 ⇒ 边解析边写的实现会先插进去一条，`created` 变 1，立刻变红。
     */
    const okItem = itemRow({ id: "22222222-2222-4222-8222-22222222aaaa" });
    const badItem = itemRow({
      id: "22222222-2222-4222-8222-22222222bbbb",
      rewriteResolved: false,
      rewrittenQuestion: null,
      sourceTraceId: "b".repeat(32),
    });
    const h = harness({ items: [okItem, badItem] });
    await expect(
      h.service.promote(
        promoteReq([
          { itemId: okItem.id, goldPoints: ["要点"] },
          { itemId: badItem.id, goldPoints: ["要点"] },
        ]),
        "a@b.c",
      ),
    ).rejects.toThrow(/指代未消解/);
    // 拒绝必须发生在**任何写入之前**：半批落库 + 400 是最难收拾的状态。
    expect(h.created).toHaveLength(0);
    expect(h.markedEnteredEvalSet).toEqual([]);
  });

  /**
   * peer review 补：`markEnteredEvalSet` 是幂等的「只写一次」语义 —— 簇上有了紫标之后
   * **照样能再点一次 [进评测集]**。没有这道比对，重试或误点会让整批问题原样再落一遍，
   * 目标集里出现整批重复的 draft 用例，人审时根本看不出哪条是重复。
   * 它同时把「promote 中途失败后重试」变成安全操作。
   */
  it("跳过目标集里已存在的同一问题（归一化精确比对，防重试造整批重复）", async () => {
    const h = harness({
      items: [itemRow({ question: "能开专票吗", rewrittenQuestion: null, rewriteResolved: true })],
      // 末尾的问号/空白差异不该让它逃过去——比对走 normalizeQuestion。
      existingCases: [{ question: "能开专票吗？ " }],
    });

    const result = await h.service.promote(
      promoteReq([{ itemId: itemRow().id, goldPoints: ["要点"] }]),
      "a@b.c",
    );

    expect(result.created).toBe(0);
    expect(h.created).toHaveLength(0);
  });

  it("accepts an unresolved item once a manual standalone question is supplied", async () => {
    const h = harness({ items: [itemRow({ rewriteResolved: false, rewrittenQuestion: null })] });
    await h.service.promote(
      promoteReq([
        { itemId: itemRow().id, question: "管理中的授权要点需要注意什么", goldPoints: ["要点"] },
      ]),
      "a@b.c",
    );
    expect(h.created[0].question).toBe("管理中的授权要点需要注意什么");
  });

  it("marks the source cluster as entered-eval-set without touching its status (原型 :634)", async () => {
    const h = harness();
    await h.service.promote(promoteReq([{ itemId: itemRow().id, goldPoints: ["要点"] }]), "a@b.c");
    expect(h.markedEnteredEvalSet).toEqual([CLUSTER]);
  });

  it("de-duplicates within the batch by normalized question（本波降级范围）", async () => {
    const a = itemRow({ id: "44444444-4444-4444-8444-444444444444" });
    const b = itemRow({ id: "55555555-5555-4555-8555-555555555555" });
    const h = harness({ items: [a, b] });
    const result = await h.service.promote(
      promoteReq([
        { itemId: a.id, question: "能开专票吗", goldPoints: ["要点"] },
        { itemId: b.id, question: "能开专票吗？", goldPoints: ["另一个要点"] },
      ]),
      "a@b.c",
    );
    expect(result.created).toBe(1);
    expect(h.created.map((c) => c.question)).toEqual(["能开专票吗"]);
  });

  it("rejects items that belong to a different cluster", async () => {
    const foreign = itemRow({ clusterId: "99999999-9999-4999-8999-999999999999" });
    const h = harness({ items: [foreign] });
    await expect(
      h.service.promote(promoteReq([{ itemId: foreign.id, goldPoints: [] }]), "a@b.c"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.created).toHaveLength(0);
  });

  it("404s on a missing cluster", async () => {
    const h = harness();
    await expect(
      h.service.promote(
        { ...promoteReq([{ itemId: itemRow().id, goldPoints: [] }]), clusterId: SET },
        "a@b.c",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("passes a 32-hex source trace id through and drops a malformed one", async () => {
    const ok = harness();
    await ok.service.promote(promoteReq([{ itemId: itemRow().id, goldPoints: [] }]), "a@b.c");
    expect(ok.created[0].sourceTraceId).toBe(TRACE);

    const short = harness({ items: [itemRow({ sourceTraceId: "manual-1" })] });
    await short.service.promote(promoteReq([{ itemId: itemRow().id, goldPoints: [] }]), "a@b.c");
    expect(short.created[0].sourceTraceId).toBeNull();
  });
});

describe("GapPromoteService.draftGold", () => {
  it("constrains the prompt to 3–5 must-have points (缺口 26 / D7)", async () => {
    const h = harness();
    await h.service.draftGold({ question: "课程可以退款吗" });
    const prompt = h.chatCalls[0].messages.map((m) => m.content).join("\n");
    expect(prompt).toMatch(/3[–-]5/);
    expect(prompt).toContain("必须");
    expect(prompt).toContain("说过");
  });

  it("drafts from question + answer only, never chunk text (9.8)", async () => {
    const h = harness();
    await h.service.draftGold({ question: "课程可以退款吗", answer: "7 天内可退" });
    const user = h.chatCalls[0].messages.find((m) => m.role === "user")!;
    // 载荷的键**恰好**是 question/answer——多一个键就是多一条内容面泄漏路径。
    expect(Object.keys(JSON.parse(user.content) as object).sort()).toEqual(["answer", "question"]);
    expect(h.chatCalls[0].messages.map((m) => m.content).join("")).not.toContain("片段");
  });

  it("returns the drafted points", async () => {
    const h = harness();
    h.chatReply.value = JSON.stringify({ goldPoints: ["7 天内无理由退", "已开课按比例", "赠品课不退"] });
    expect((await h.service.draftGold({ question: "课程可以退款吗" })).goldPoints).toEqual([
      "7 天内无理由退",
      "已开课按比例",
      "赠品课不退",
    ]);
  });

  it("throws instead of inventing points when the model returns garbage", async () => {
    const h = harness();
    h.chatReply.value = "not json at all";
    await expect(h.service.draftGold({ question: "课程可以退款吗" })).rejects.toThrow(/草拟失败/);
  });

  it("throws when the model returns fewer than 3 points（3–5 是硬约束）", async () => {
    const h = harness();
    h.chatReply.value = JSON.stringify({ goldPoints: ["只有一条"] });
    await expect(h.service.draftGold({ question: "课程可以退款吗" })).rejects.toThrow(/草拟失败/);
  });

  it("surfaces a provider failure as a readable error", async () => {
    const h = harness();
    h.chatError.value = new Error("upstream 502");
    await expect(h.service.draftGold({ question: "课程可以退款吗" })).rejects.toThrow(/upstream 502/);
  });

  it("400s when no judge model is configured", async () => {
    const h = harness({ judgeModelId: null });
    await expect(h.service.draftGold({ question: "课程可以退款吗" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
