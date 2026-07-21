import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { EvalCase } from "@codecrush/contracts";
import { GapPromoteService } from "./gap-promote.service";
import { DUPLICATE_COMPARE_CASE_LIMIT } from "./gap.constants";
import type { GapItemRow } from "./schema";
import type { GapsRepository } from "./gaps.repository";
import type { EvaluationsRepository } from "../evaluations/evaluations.repository";
import type { ModelsService } from "../models/models.service";
import type { EvalSetsService } from "../eval-runs/eval-sets.service";
import type { DB } from "../../platform/persistence/persistence.module";

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
  /** 真正落库的用例（`createCasesBatchTx` 的产物），断言对着它，不是对着调用次数。 */
  created: EvalCase[];
  markedEnteredEvalSet: string[];
  chatCalls: { modelId: string; messages: { role: string; content: string }[] }[];
  chatReply: { value: string };
  chatError: { value: Error | null };
  /** 每次 `embedTexts` 的入参文本。断言「目标集为空时一次都不发」靠它。 */
  embedCalls: string[][];
}

/**
 * 假 tx 的哨兵。promote 必须把**顶层事务的那一个** tx 原样传给两个域的方法——
 * 传错（比如某个方法偷偷自开事务）就不再是同一个原子单元，下面的假仓库当场炸。
 */
const FAKE_TX = Symbol("fake-tx");

function harness(
  options: {
    items?: GapItemRow[];
    judgeModelId?: string | null;
    embeddingModelId?: string | null;
    /** 目标集里**已经有**的用例（用于跨集去重的用例）。 */
    existingCases?: { id?: string; question: string }[];
    /**
     * 按**文本**指定 embedding 向量。语义近似用例靠它造「相似 / 不相似」两种情形：
     * 相似度是真算出来的（走 `cosineSimilarity`），不是桩死的判定结果。
     * 未列出的文本落到 `[1, 0]`。
     */
    vectors?: Record<string, number[]>;
    /** 批量插入跑到这条问题时抛错——用来验证整批回滚。 */
    failOnQuestion?: string;
  } = {},
): Harness {
  const items = options.items ?? [itemRow()];
  const created: EvalCase[] = [];
  const markedEnteredEvalSet: string[] = [];
  const chatCalls: Harness["chatCalls"] = [];
  const embedCalls: string[][] = [];
  const chatReply = { value: JSON.stringify({ goldPoints: ["要点一", "要点二", "要点三"] }) };
  const chatError: { value: Error | null } = { value: null };

  const repo = {
    findCluster: async (id: string) =>
      id === CLUSTER ? { id: CLUSTER, deletedAt: null } : undefined,
    listItemsByIds: async (ids: string[]) => items.filter((row) => ids.includes(row.id)),
    markEnteredEvalSetTx: async (tx: unknown, id: string) => {
      expect(tx).toBe(FAKE_TX);
      markedEnteredEvalSet.push(id);
    },
  } as unknown as GapsRepository;

  /**
   * 假事务，**带真回滚语义**：事务体抛错就把两个数组恢复到进入前的快照。
   *
   * 不做成「直接调用回调」的纯 pass-through：那样的桩在失败路径上永远显示「什么都没留下」，
   * 原子性用例就会是自证的——它测的是桩不会记账，不是 promote 把两个域收进了同一个事务。
   */
  const db = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const snapshot = { created: created.length, marked: markedEnteredEvalSet.length };
      try {
        return await fn(FAKE_TX);
      } catch (error) {
        created.length = snapshot.created;
        markedEnteredEvalSet.length = snapshot.marked;
        throw error;
      }
    },
  } as unknown as DB;

  const evaluations = {
    getSettings: async () => ({
      judgeModelId: options.judgeModelId === undefined ? "judge-1" : options.judgeModelId,
      embeddingModelId:
        options.embeddingModelId === undefined ? "embed-1" : options.embeddingModelId,
    }),
  } as unknown as EvaluationsRepository;

  const models = {
    chat: async (modelId: string, messages: { role: string; content: string }[]) => {
      chatCalls.push({ modelId, messages });
      if (chatError.value) throw chatError.value;
      return { content: chatReply.value };
    },
    embedTexts: async (_modelId: string, texts: string[]) => {
      embedCalls.push(texts);
      return texts.map((text) => options.vectors?.[text] ?? [1, 0]);
    },
  } as unknown as ModelsService;

  const evalSets = {
    /** 目标集**既有**用例——promote 先做归一化精确比对，再做 embedding 语义近似比对。 */
    listCases: async () =>
      (options.existingCases ?? []).map((c, i) => ({
        id: c.id ?? `case-existing-${i + 1}`,
        question: c.question,
      })),
    createCasesBatchTx: async (
      tx: unknown,
      setId: string,
      entries: { question: string; goldPoints: string[]; sourceTraceId?: string }[],
    ) => {
      expect(tx).toBe(FAKE_TX);
      const rows: EvalCase[] = [];
      for (const req of entries) {
        if (options.failOnQuestion !== undefined && req.question === options.failOnQuestion) {
          throw new Error(`insert failed: ${req.question}`);
        }
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
        rows.push(row);
      }
      return rows;
    },
  } as unknown as EvalSetsService;

  return {
    service: new GapPromoteService(repo, evaluations, models, evalSets, db),
    created,
    markedEnteredEvalSet,
    chatCalls,
    chatReply,
    chatError,
    embedCalls,
  };
}

const promoteReq = (
  items: { itemId: string; question?: string; goldPoints: string[]; force?: boolean }[],
) => ({
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

  /**
   * 021 §12② 的收口：B2a 的逐条插入会在这里留下「第一条已入集、第二条失败」的半批状态。
   * 现在整批与簇标志同一个事务，失败即整体回滚。
   */
  it("rolls the whole batch back when one insert fails —— 不留半批已入集", async () => {
    const a = itemRow({ id: "66666666-6666-4666-8666-666666666666" });
    const b = itemRow({ id: "77777777-7777-4777-8777-777777777777" });
    const h = harness({ items: [a, b], failOnQuestion: "第二条会炸" });

    await expect(
      h.service.promote(
        promoteReq([
          { itemId: a.id, question: "第一条没问题", goldPoints: ["要点"] },
          { itemId: b.id, question: "第二条会炸", goldPoints: ["要点"] },
        ]),
        "a@b.c",
      ),
    ).rejects.toThrow("insert failed: 第二条会炸");

    // ① 先插进去的那条也没留下 —— 整批回滚，不是「已加入 1 条，其余失败」。
    expect(h.created).toHaveLength(0);
    // ② 簇没有被标成「已进评测集」—— 否则一个其实没入集的簇会看起来已经完事。
    expect(h.markedEnteredEvalSet).toEqual([]);
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

/**
 * 语义近似重复检测（原型 `:269`，021 §12② 的第三条收口）。
 *
 * 向量都由 `vectors` 显式给出，相似度由被测代码真算（`cosineSimilarity`），
 * 桩不参与「像不像」的判定——否则测的是桩的返回值，不是阈值口径。
 */
describe("GapPromoteService.promote —— 语义近似重复", () => {
  const CASE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  /** 与 [1,0] 夹角 ~11.5°，余弦 ≈0.98 —— 严格大于 0.95。 */
  const NEAR = [0.98, 0.2];
  /** 与 [1,0] 正交，余弦 = 0 —— 远低于阈值。 */
  const FAR = [0, 1];

  const askItem = itemRow({
    question: "能开专票吗",
    rewrittenQuestion: null,
    rewriteResolved: true,
  });

  it("相似度 >0.95 且未带 force ⇒ 不写入，改进 warnings（带最相似用例与相似度）", async () => {
    const h = harness({
      items: [askItem],
      existingCases: [{ id: CASE_A, question: "可以开增值税专用发票吗" }],
      vectors: { 能开专票吗: NEAR, 可以开增值税专用发票吗: [1, 0] },
    });

    const result = await h.service.promote(
      promoteReq([{ itemId: askItem.id, goldPoints: ["要点"] }]),
      "a@b.c",
    );

    expect(result.created).toBe(0);
    expect(h.created).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0].itemId).toBe(askItem.id);
    expect(result.warnings![0].similarTo).toEqual({
      caseId: CASE_A,
      question: "可以开增值税专用发票吗",
    });
    expect(result.warnings![0].similarity).toBeGreaterThan(0.95);
  });

  it("同样条件带 force: true ⇒ 正常写入，且不进 warnings（原型明写「可强制加入」）", async () => {
    const h = harness({
      items: [askItem],
      existingCases: [{ id: CASE_A, question: "可以开增值税专用发票吗" }],
      vectors: { 能开专票吗: NEAR, 可以开增值税专用发票吗: [1, 0] },
    });

    const result = await h.service.promote(
      promoteReq([{ itemId: askItem.id, goldPoints: ["要点"], force: true }]),
      "a@b.c",
    );

    expect(result.created).toBe(1);
    expect(h.created[0].question).toBe("能开专票吗");
    expect(result.warnings).toBeUndefined();
    // force 的条目**整个跳过**检查：既然结果注定被忽略，那次 embed 就是白花的钱。
    expect(h.embedCalls).toEqual([]);
  });

  it("相似度低于阈值 ⇒ 正常写入，无 warning", async () => {
    const h = harness({
      items: [askItem],
      existingCases: [{ id: CASE_A, question: "课程可以退款吗" }],
      vectors: { 能开专票吗: FAR, 课程可以退款吗: [1, 0] },
    });

    const result = await h.service.promote(
      promoteReq([{ itemId: askItem.id, goldPoints: ["要点"] }]),
      "a@b.c",
    );

    expect(result.created).toBe(1);
    expect(result.warnings).toBeUndefined();
  });

  it("恰好等于 0.95 不触发（阈值是严格大于，不是 >=）", async () => {
    // 与 [1,0] 的余弦恰为 0.95：cos = 0.95 / sqrt(0.95² + s²)，取 s = sqrt(1-0.95²) 即得 0.95。
    const exact = [0.95, Math.sqrt(1 - 0.95 * 0.95)];
    const h = harness({
      items: [askItem],
      existingCases: [{ id: CASE_A, question: "可以开增值税专用发票吗" }],
      vectors: { 能开专票吗: exact, 可以开增值税专用发票吗: [1, 0] },
    });

    const result = await h.service.promote(
      promoteReq([{ itemId: askItem.id, goldPoints: ["要点"] }]),
      "a@b.c",
    );

    expect(result.created).toBe(1);
    expect(result.warnings).toBeUndefined();
  });

  it("目标集为空 ⇒ 一次 embed 都不发（省一次网络往返）", async () => {
    const h = harness({ items: [askItem], existingCases: [] });

    const result = await h.service.promote(
      promoteReq([{ itemId: askItem.id, goldPoints: ["要点"] }]),
      "a@b.c",
    );

    expect(result.created).toBe(1);
    expect(h.embedCalls).toEqual([]);
    expect(result.duplicateCheckTruncated).toBeUndefined();
  });

  it("没配 embedding 模型 ⇒ 跳过语义层，不把 promote 拖垮", async () => {
    const h = harness({
      items: [askItem],
      embeddingModelId: null,
      existingCases: [{ id: CASE_A, question: "可以开增值税专用发票吗" }],
      vectors: { 能开专票吗: NEAR, 可以开增值税专用发票吗: [1, 0] },
    });

    const result = await h.service.promote(
      promoteReq([{ itemId: askItem.id, goldPoints: ["要点"] }]),
      "a@b.c",
    );

    expect(result.created).toBe(1);
    expect(h.embedCalls).toEqual([]);
  });

  it("目标集超过上限 ⇒ 只比对前 N 条，且截断对调用方可见", async () => {
    // 上限之外那条才是与候选近似的——若实现没截断，它会被查到并挡下候选，本用例立刻变红。
    const existingCases = [
      ...Array.from({ length: DUPLICATE_COMPARE_CASE_LIMIT }, (_, i) => ({
        id: `case-far-${i}`,
        question: `无关问题 ${i}`,
      })),
      { id: CASE_A, question: "可以开增值税专用发票吗" },
    ];
    const h = harness({
      items: [askItem],
      existingCases,
      vectors: {
        能开专票吗: NEAR,
        可以开增值税专用发票吗: [1, 0],
        ...Object.fromEntries(
          Array.from({ length: DUPLICATE_COMPARE_CASE_LIMIT }, (_, i) => [`无关问题 ${i}`, FAR]),
        ),
      },
    });

    const result = await h.service.promote(
      promoteReq([{ itemId: askItem.id, goldPoints: ["要点"] }]),
      "a@b.c",
    );

    // ① 上限之外的那条近似用例没被查到 ⇒ 候选照常入集。
    expect(result.created).toBe(1);
    expect(result.warnings).toBeUndefined();
    // ② 截断没有被静默吞掉：调用方拿得到「只比了多少 / 一共多少」。
    expect(result.duplicateCheckTruncated).toEqual({
      comparedCases: DUPLICATE_COMPARE_CASE_LIMIT,
      totalCases: DUPLICATE_COMPARE_CASE_LIMIT + 1,
    });
    // ③ 发出去的文本正好是 1 条候选 + 上限条既有用例，没有把整集拖去 embed。
    expect(h.embedCalls).toHaveLength(1);
    expect(h.embedCalls[0]).toHaveLength(1 + DUPLICATE_COMPARE_CASE_LIMIT);
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
    h.chatReply.value = JSON.stringify({
      goldPoints: ["7 天内无理由退", "已开课按比例", "赠品课不退"],
    });
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
    await expect(h.service.draftGold({ question: "课程可以退款吗" })).rejects.toThrow(
      /upstream 502/,
    );
  });

  it("400s when no judge model is configured", async () => {
    const h = harness({ judgeModelId: null });
    await expect(h.service.draftGold({ question: "课程可以退款吗" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
