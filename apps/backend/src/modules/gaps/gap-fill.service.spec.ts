import { BadRequestException, ConflictException } from "@nestjs/common";
import type { SubmitFillRequest } from "@codecrush/contracts";
import { GapFillService } from "./gap-fill.service";
import type { GapsService } from "./gaps.service";
import type { DocumentsService } from "../documents/documents.service";
import type { EvaluationsRepository } from "../evaluations/evaluations.repository";
import type { KnowledgeBasesRepository } from "../knowledge-bases/knowledge-bases.repository";
import type { ModelsService } from "../models/models.service";

/**
 * `[补知识库]` 向导的服务端行为（021 决策 I，原型 §9 `:367` / §19.1 `:746-748`）。
 *
 * 断言落在**产出**上——发给判官的 prompt 载荷、真正交给上传管线的文件内容、
 * 失败后簇停在哪个状态——不断言「某方法被调用过」。
 * 唯一的例外是那条红线用例：它要证明的恰恰是**没有发生的事**（上传没被调用），
 * 只能观察依赖被怎么使用。
 */

const CLUSTER = "11111111-1111-4111-8111-111111111111";
const KB = "44444444-4444-4444-8444-444444444444";
const APP = "55555555-5555-4555-8555-555555555555";
const VERSION = "66666666-6666-4666-8666-666666666666";
const DOC = "77777777-7777-4777-8777-777777777777";

interface Harness {
  service: GapFillService;
  /** 交给上传管线的东西——红线用例断言它保持为空。 */
  uploads: { kbId: string; content: string; originalname: string; autoParse: boolean }[];
  chatCalls: { messages: { role: string; content: string }[] }[];
  transitions: string[];
  chatReply: { value: string };
  chatError: { value: Error | null };
}

function harness(
  options: {
    status?: string;
    judgeModelId?: string | null;
    kbStatus?: string;
    kbMissing?: boolean;
    draftQuestion?: string | null;
    draftAnswer?: string | null;
    /** 非空 ⇒ submitFill 的 CAS 输给一个把簇推到该状态的并发写者（QA 复现的场景）。 */
    loseCasTo?: string;
    /** 非空 ⇒ documents.upload 抛这个错，用来验回滚。 */
    uploadError?: Error;
  } = {},
): Harness {
  const uploads: Harness["uploads"] = [];
  const chatCalls: Harness["chatCalls"] = [];
  const transitions: string[] = [];
  const chatReply = {
    value: JSON.stringify({ question: "能否开具专用发票", answer: "可以，下单时选专票。" }),
  };
  const chatError: { value: Error | null } = { value: null };
  let status = options.status ?? "pending";

  const gaps = {
    mustFindForFill: async () => ({
      id: CLUSTER,
      status,
      representativeQuestion: "能开专用发票吗",
      fillDraftQuestion: options.draftQuestion ?? null,
      fillDraftAnswer: options.draftAnswer ?? null,
      fillTargetKbId: null,
      fillTargetDocumentId: null,
      fillVerifyApplicationId: null,
      fillVerifyConfigVersionId: null,
      fillPreScore: null,
    }),
    startDraft: async () => {
      if (status !== "pending") throw new BadRequestException("illegal transition");
      transitions.push("startDraft");
      status = "drafting";
      return {} as never;
    },
    cancelDraft: async () => {
      transitions.push("cancelDraft");
      status = "pending";
      return {} as never;
    },
    cancelReview: async () => {
      transitions.push("cancelReview");
      status = "pending";
      return {} as never;
    },
    recordDraftReady: async (_id: string, question: string, answer: string) => {
      transitions.push(`draftReady:${question}|${answer}`);
      status = "reviewing";
      return {} as never;
    },
    submitFill: async (_id: string, target: { question: string; documentId: string | null }) => {
      if (status !== "reviewing") throw new BadRequestException("illegal transition");
      /**
       * 模拟**真实的 CAS 竞争者**：`options.loseCasTo` 非空时，表示在本次 CAS 落地之前
       * 另一个请求已经把簇推走了（QA 复现的场景是并发「驳回」）。真实 repository 的
       * `WHERE status = 'reviewing'` 会影响 0 行，service 据此抛 ConflictException。
       *
       * 不这么模拟的话，这条回归测试就是空的——fake 里 status 永远由我们自己顺序改，
       * 竞争根本不会发生。本波已经吃过好几次「测试看起来在守、实际恒真」的亏。
       */
      if (options.loseCasTo) {
        status = options.loseCasTo;
        throw new ConflictException("并发冲突：该缺口刚被其他操作改动，请刷新后重试");
      }
      transitions.push(`submitFill:${target.documentId}:${target.question}`);
      status = "filled";
      return {} as never;
    },
    attachFillDocument: async (_id: string, documentId: string) => {
      if (status !== "filled") throw new ConflictException("并发冲突");
      transitions.push(`attachFillDocument:${documentId}`);
      return {} as never;
    },
    recordVerifyIngestFailed: async () => {
      transitions.push("verifyIngestFailed");
      status = "pending";
      return {} as never;
    },
  } as unknown as GapsService;

  const documents = {
    upload: async (
      kbId: string,
      files: { originalname: string; buffer: Buffer }[],
      opts: { autoParse: boolean },
    ) => {
      if (options.uploadError) throw options.uploadError;
      uploads.push({
        kbId,
        content: files[0].buffer.toString("utf8"),
        originalname: files[0].originalname,
        autoParse: opts.autoParse,
      });
      return [{ id: DOC }];
    },
  } as unknown as DocumentsService;

  const knowledgeBases = {
    findById: async () =>
      options.kbMissing ? undefined : { id: KB, status: options.kbStatus ?? "ready" },
  } as unknown as KnowledgeBasesRepository;

  const evaluations = {
    getSettings: async () => ({
      judgeModelId: options.judgeModelId === undefined ? "judge-1" : options.judgeModelId,
    }),
  } as unknown as EvaluationsRepository;

  const models = {
    chat: async (_id: string, messages: { role: string; content: string }[]) => {
      chatCalls.push({ messages });
      if (chatError.value) throw chatError.value;
      return { content: chatReply.value };
    },
  } as unknown as ModelsService;

  return {
    service: new GapFillService(gaps, documents, knowledgeBases, evaluations, models),
    uploads,
    chatCalls,
    transitions,
    chatReply,
    chatError,
  };
}

const submitReq = (over: Partial<SubmitFillRequest> = {}): SubmitFillRequest => ({
  question: "能否开具专用发票",
  answer: "可以，下单时在开票信息里选择「增值税专用发票」。",
  targetKbId: KB,
  applicationId: APP,
  configVersionId: VERSION,
  confirmed: true,
  ...over,
});

describe("GapFillService.draftFill", () => {
  it("草拟载荷**只有问题**——不带原答案、不带召回片段（021 决策 A 禁止的两条边）", async () => {
    const h = harness();
    await h.service.draftFill(CLUSTER);

    const user = h.chatCalls[0].messages.find((m) => m.role === "user")!;
    expect(Object.keys(JSON.parse(user.content))).toEqual(["question"]);
  });

  it("prompt 明说「你不掌握内部资料」——防模型用笃定语气编出像查过资料的内容", async () => {
    const h = harness();
    await h.service.draftFill(CLUSTER);

    const system = h.chatCalls[0].messages.find((m) => m.role === "system")!;
    expect(system.content).toContain("你并不掌握该组织的内部资料");
    expect(system.content).toContain("（待确认）");
  });

  it("草拟成功 → 走 startDraft 再 draftReady，落库的是模型给的 Q/A", async () => {
    const h = harness();
    await h.service.draftFill(CLUSTER);

    expect(h.transitions).toEqual([
      "startDraft",
      "draftReady:能否开具专用发票|可以，下单时选专票。",
    ]);
  });

  it("模型调用失败 → 簇退回 pending，不留在 drafting 里烂着", async () => {
    const h = harness();
    h.chatError.value = new Error("judge down");

    await expect(h.service.draftFill(CLUSTER)).rejects.toThrow(/草拟失败/);
    // 留在 drafting 的话，屏5 那行会永远显示「草拟中」且无人推动——用户既看不到原因，
    // 也不能重新发起（startDraft 只从 pending 进）。
    expect(h.transitions).toEqual(["startDraft", "cancelDraft"]);
  });

  it("模型返回解析不了 → 同样退回 pending，且**绝不编造**一条草稿", async () => {
    const h = harness();
    h.chatReply.value = "不是 JSON";

    await expect(h.service.draftFill(CLUSTER)).rejects.toThrow(/未返回合法的问答对/);
    expect(h.transitions).toEqual(["startDraft", "cancelDraft"]);
  });

  it("没配判官模型 → 在推进状态**之前**就 400，不白留一个要回滚的态", async () => {
    const h = harness({ judgeModelId: null });

    await expect(h.service.draftFill(CLUSTER)).rejects.toThrow(/未配置判官模型/);
    expect(h.transitions).toEqual([]);
  });
});

describe("GapFillService.submitFill", () => {
  it("未勾选「我已核对」→ 400，且**一个字都没进上传管线**（红线：无人审不入库）", async () => {
    const h = harness({ status: "reviewing" });

    await expect(h.service.submitFill(CLUSTER, submitReq({ confirmed: false }))).rejects.toThrow(
      /我已核对/,
    );
    expect(h.uploads).toEqual([]);
    expect(h.transitions).toEqual([]);
  });

  it("**红线的结构保证**：`reviewing` 之外的状态根本走不到上传这一步", async () => {
    // 这条是整个向导最重要的不变量：草拟出来的内容不可能绕过人审直接入库。
    // 守卫不在本 service 里而在状态机（submitFill 只从 reviewing 进），
    // 所以这里断言的是「状态不对时 upload 没被调用过」。
    for (const status of ["pending", "drafting", "filled", "verified", "ignored"]) {
      const h = harness({ status });
      await expect(h.service.submitFill(CLUSTER, submitReq())).rejects.toThrow();
      expect(h.uploads).toEqual([]);
    }
  });

  it("目标 KB 重建中 → 400，不入库（原型 §19.1 逐字文案）", async () => {
    const h = harness({ status: "reviewing", kbStatus: "building" });

    await expect(h.service.submitFill(CLUSTER, submitReq())).rejects.toThrow(/知识库重建中/);
    expect(h.uploads).toEqual([]);
  });

  it("目标 KB 不存在 → 400", async () => {
    const h = harness({ status: "reviewing", kbMissing: true });
    await expect(h.service.submitFill(CLUSTER, submitReq())).rejects.toThrow(/知识库不存在/);
    expect(h.uploads).toEqual([]);
  });

  it("入库内容用 `问：`/`答：` 配对格式，交给既有管线并开 autoParse", async () => {
    const h = harness({ status: "reviewing" });
    await h.service.submitFill(CLUSTER, submitReq());

    expect(h.uploads).toHaveLength(1);
    const [upload] = h.uploads;
    expect(upload.kbId).toBe(KB);
    expect(upload.autoParse).toBe(true);
    expect(upload.originalname).toBe(`gap-fill-${CLUSTER}.txt`);
    // QaChunker 认这个格式就逐对切片，不认就退化成通用切片——两条路都不会失败。
    expect(upload.content).toBe(
      "问：能否开具专用发票\n答：可以，下单时在开票信息里选择「增值税专用发票」。\n",
    );
  });

  it("入库的是**请求里人审后的内容**，不是库里那份 LLM 原稿", async () => {
    // 库里存的草稿是「原始草稿」，请求带的是人改过的版本。若实现读库里那份，
    // 用户在第②步敲的每个字都不会离开浏览器——人审就退化成一次点击确认。
    const h = harness({
      status: "reviewing",
      draftQuestion: "原始草稿问题",
      draftAnswer: "原始草稿答案",
    });
    await h.service.submitFill(
      CLUSTER,
      submitReq({ question: "人审改过的问题", answer: "人审改过的答案" }),
    );

    expect(h.uploads[0].content).toBe("问：人审改过的问题\n答：人审改过的答案\n");
    // 并且**覆盖回**草稿列：留档的要与真正入库的那份一致。
    expect(h.transitions).toEqual(["submitFill:null:人审改过的问题", `attachFillDocument:${DOC}`]);
  });

  /**
   * ⚠️ 这条**取代**了原来的「先上传、再迁移状态」——那个顺序是错的，运行时 QA 把它证伪了。
   *
   * 原注释论证「上传成功但状态没写成，代价小得多，用户重新走一遍向导即可」。
   * QA 实测：并发「驳回」vs「确认入库」**5 轮 4 中**产生孤儿文档，簇最终 `pending`
   * （记录是「已驳回」）而被驳回的内容已经进 KB、切片并 embedding、进入检索候选集；
   * 且这些文档没有任何行引用、后端一行日志都没有。
   */
  it("⛔ CAS 输给并发驳回时，**一个字节都不许进 KB**（QA 复现的孤儿文档）", async () => {
    // loseCasTo:"pending" = 在 CAS 落地前，另一个请求已经把簇驳回了。
    const h = harness({ status: "reviewing", loseCasTo: "pending" });

    await expect(h.service.submitFill(CLUSTER, submitReq())).rejects.toThrow(ConflictException);

    // 核心断言：抢占失败必须发生在**上传之前**。
    // 顺序反过来的话这里是 1——那正是 KB 里那 5 份孤儿的来源。
    expect(h.uploads).toEqual([]);
  });

  it("CAS 抢占成功后才上传，文档 id 事后补写", async () => {
    const h = harness({ status: "reviewing" });
    await h.service.submitFill(CLUSTER, submitReq());

    // submitFill 先跑且 documentId 为 null（此刻文档还不存在），拿到 id 后再 attach。
    expect(h.transitions).toEqual(["submitFill:null:能否开具专用发票", `attachFillDocument:${DOC}`]);
    expect(h.uploads).toHaveLength(1);
  });

  it("上传失败 ⇒ 簇退回 pending，不留在只剩「忽略」可走的 filled", async () => {
    // 抢占成功之后上传炸了。不回滚的话簇停在 filled 且没有文档，
    // 回验监听器永远等不到一份根本没被创建的文档 —— 死态。
    const h = harness({ status: "reviewing", uploadError: new Error("KB 磁盘满") });

    await expect(h.service.submitFill(CLUSTER, submitReq())).rejects.toThrow("KB 磁盘满");

    expect(h.transitions).toEqual(["submitFill:null:能否开具专用发票", "verifyIngestFailed"]);
    expect(h.uploads).toEqual([]);
  });
});
