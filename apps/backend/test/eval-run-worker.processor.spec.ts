import { NotFoundException } from "@nestjs/common";
import { EVAL_RUN_JOB } from "../src/platform/queue/queue.constants";
import {
  EvalRunWorkerProcessor,
  decideVerdict,
} from "../src/modules/eval-runs/eval-run-worker.processor";
import type { NewEvalRunResultInput } from "../src/modules/eval-runs/eval-runs.repository";
import type { EvalRunRow, EvalRunSnapshotEntry } from "../src/modules/eval-runs/schema";
import type { OfflineEvaluationScores } from "../src/modules/evaluations/evaluation.types";

const now = new Date("2026-07-16T00:00:00.000Z");
const APP_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

function c(seq: number): EvalRunSnapshotEntry {
  return { caseId: `case-${seq}`, caseVersionId: `cv-${seq}`, seq };
}

function scores(overrides: Partial<OfflineEvaluationScores> = {}): OfflineEvaluationScores {
  return {
    faithfulness: 90,
    answerRelevancy: 90,
    contextPrecision: 90,
    correctness: null,
    citation: null,
    evidence: { faithfulness: ["ok"] },
    usage: { inputTokens: 0, outputTokens: 0 },
    ...overrides,
  };
}

interface SetupOptions {
  snapshot?: EvalRunSnapshotEntry[];
  /** 跑完第 N 条后置停止信号（模拟用户中途点停止）。 */
  stopAfter?: number;
  tokenBudget?: number;
  usagePerCase?: number;
  /** 这些 seq 的用例编排超时。 */
  timeoutOn?: number[];
  /** 这些 seq 的用例编排**失败**（yield error 后 return，不抛）——replyText 为空。 */
  errorOn?: number[];
  /** 这些 seq 的用例编排「成功」但答案为空（无 error、无 timeout）。 */
  emptyAnswerOn?: number[];
  resolveThrows?: boolean;
  leaseBusy?: boolean;
  /** 第 N 次续租之后开始失败（模拟租约被回收器收走/被别的 worker 接管）。 */
  leaseLostAfter?: number;
  /**
   * `markRunning` 的条件更新不匹配（模拟 `tryAcquireLease` 与 `markRunning` 之间被回收器
   * 判死并清空租约 —— `create()` 的回收器跑在 `findActiveRun` 守卫之前，任一 POST 都触发它）。
   */
  markRunningLost?: boolean;
  /** 15(a)：收尾时租约已失去（回收器先判 failed / 已被接管）。 */
  finishRunLost?: boolean;
  /** 15(b)：第 N 次 `recordResult` 时失去租约（模拟回收落在 runCase 执行中）。 */
  recordResultLostAt?: number;
  scores?: Partial<OfflineEvaluationScores>;
  runStatus?: EvalRunRow["status"];
  recorded?: string[];
  /** F5：每题重复次数（默认 1）。 */
  repeatCount?: number;
  /** F2：这些 seq 的用例带 gold 引用（用于检索指标回填断言）。 */
  goldRefSeqs?: number[];
  /** F2：这些 seq 的编排返回 retrievalExecuted=false（CHAT 短路）。 */
  noRetrievalOn?: number[];
  /** 注入的 `AppConfigService.evalRunCaseTimeoutMs`（默认取离线默认值 120s）。 */
  caseTimeoutMs?: number;
}

function setup(opts: SetupOptions = {}) {
  const snapshot = opts.snapshot ?? [c(1)];
  const run: EvalRunRow = {
    id: "r1",
    setId: "11111111-1111-4111-8111-111111111111",
    applicationId: APP_ID,
    configVersionId: VERSION_ID,
    judgeModelId: "44444444-4444-4444-8444-444444444444",
    embeddingModelId: "55555555-5555-4555-8555-555555555555",
    offlineJudgeVersion: "offline-v1",
    status: opts.runStatus ?? "queued",
    scope: "all",
    repeatCount: opts.repeatCount ?? 1,
    caseVersionSnapshot: snapshot,
    totalCases: snapshot.length,
    doneCases: 0,
    tokenBudget: opts.tokenBudget ?? 500000,
    tokensUsed: 0,
    stopRequestedAt: null,
    leaseOwner: null,
    leaseUntil: null,
    startedAt: null,
    finishedAt: null,
    error: null,
    createdBy: "admin",
    createdAt: now,
  };
  const runs = new Map<string, EvalRunRow>([[run.id, run]]);
  const results: NewEvalRunResultInput[] = [];
  let renewCalls = 0;

  const repo = {
    async tryAcquireLease() {
      return !opts.leaseBusy;
    },
    // 逐条续租：默认成功；opts.leaseLostAfter 模拟租约被回收/接管后 worker 必须让位。
    async renewLease() {
      renewCalls += 1;
      return opts.leaseLostAfter === undefined || renewCalls <= opts.leaseLostAfter;
    },
    async releaseLease() {},
    async findRunById(id: string) {
      return runs.get(id);
    },
    // 条件更新（**只**看 `lease_owner = owner`——所有权即守卫，见 018 §12 缺口 15(d)）：
    // 返回 false = 我已不是所有者。无条件写会把一条已被回收的 failed run 复活成
    // running + NULL 租约 —— 两条回收臂都够不着的永久死锁（见 eval-runs.lease.db.spec.ts；
    // 那条性质活在 SQL 三值逻辑上，只有真库测得到，此处的 fake 只守 worker 的**让位行为**）。
    async markRunning(id: string, _owner: string, at: Date) {
      if (opts.markRunningLost) return false;
      const row = runs.get(id)!;
      row.status = "running";
      row.startedAt = at;
      return true;
    },
    async finishRunAsOwner(
      id: string,
      status: string,
      at: Date,
      error: string | null,
      _owner: string,
    ) {
      if (opts.finishRunLost) return false;
      const row = runs.get(id)!;
      row.status = status as EvalRunRow["status"];
      row.finishedAt = at;
      row.error = error;
      return true;
    },
    async finishRunUnowned() {
      return true;
    },
    async recordResult(input: NewEvalRunResultInput & { owner: string }) {
      // 第 N 次记录时失去租约（模拟回收落在 runCase 执行中）
      if (opts.recordResultLostAt !== undefined && results.length + 1 === opts.recordResultLostAt) {
        return false;
      }
      results.push(input);
      const row = runs.get(input.runId)!;
      row.doneCases += 1;
      row.tokensUsed += input.tokensUsed;
      // 跑完第 N 条后模拟用户点停止（service 只置信号，不改状态）。
      if (opts.stopAfter !== undefined && results.length === opts.stopAfter) {
        row.stopRequestedAt = now;
      }
      return true;
    },
    async listRecordedCaseVersionIds() {
      // F5：唯一索引现含 repeat_index → 返回 (caseVersionId, repeatIndex) 二元组。
      return (opts.recorded ?? []).map((caseVersionId) => ({ caseVersionId, repeatIndex: 1 }));
    },
    async findCaseVersionsByIds(ids: string[]) {
      return ids.map((id) => {
        const seq = Number(id.replace("cv-", ""));
        return {
          id,
          caseId: id.replace("cv-", "case-"),
          version: 1,
          question: `问题 ${id.replace("cv-", "")}`,
          goldPoints: [] as string[],
          // F2：带 gold 引用的用例（doc 级 ref），供检索指标回填断言。
          goldDocRefs: (opts.goldRefSeqs ?? []).includes(seq)
            ? [{ docId: `d${seq}`, chunkId: null, docName: "", section: null }]
            : [],
        };
      });
    },
  };

  const orchestration = {
    // 第 3 参（`{ runId, timeoutMs }`）显式入签名：超时预算是注入配置而非常量后，
    // 「worker 到底把哪个值传下去了」本身就是要断言的行为。
    runForEvaluation: jest.fn(
      async (_cfg: unknown, question: string, _opts: { runId: string; timeoutMs: number }) => {
      const seq = Number(question.replace("问题 ", ""));
      const timedOut = (opts.timeoutOn ?? []).includes(seq);
      const errored = (opts.errorOn ?? []).includes(seq);
      const empty = (opts.emptyAnswerOn ?? []).includes(seq);
      const retrievalExecuted = !(opts.noRetrievalOn ?? []).includes(seq);
      return {
        traceId: `trace-${seq}`,
        // 编排失败与「成功但答案为空」在返回值上同形：error 事件不抛，生成器正常收尾。
        replyText: errored || empty ? "" : `回答 ${seq}`,
        // 真实 chunkId —— 绝不合成 c1/c2（Global Constraints）。
        hits: [{ chunkId: `chunk-${seq}`, text: `片段 ${seq}`, finalScore: 0.9 }],
        // F2：检索排序列表（含 docId）——gold 指标据此比对；这里让 docId 匹配 goldRefSeqs 的 ref。
        retrievedHits: [{ chunkId: `chunk-${seq}`, docId: `d${seq}` }],
        retrievalExecuted,
        usage: { inputTokens: opts.usagePerCase ?? 0, outputTokens: 0 },
        isFallback: false,
        timedOut,
        ...(errored ? { error: "生成失败，请稍后重试" } : {}),
      };
      },
    ),
  };

  const judge = { scoreOffline: jest.fn(async () => scores(opts.scores)) };
  const applications = {
    resolveForTest: jest.fn(async () => {
      if (opts.resolveThrows) throw new NotFoundException("版本不存在");
      return { applicationId: APP_ID, configVersionId: VERSION_ID, version: 7 };
    }),
  };
  const queue = { publish: jest.fn(async () => undefined), subscribe: jest.fn(), schedule: jest.fn() };

  const config = { evalRunCaseTimeoutMs: opts.caseTimeoutMs ?? 120_000 };
  const processor = new EvalRunWorkerProcessor(
    queue as never,
    repo as never,
    orchestration as never,
    judge as never,
    applications as never,
    config as never,
  );
  return {
    processor,
    runs,
    results,
    queue,
    orchestration,
    judge,
    applications,
    /** 续租次数——租约心跳的可观测点（见「租约续期」用例）。 */
    renewCount: () => renewCalls,
  };
}

describe("decideVerdict", () => {
  it("取非 null 指标最低档；correctness=null（无 gold）不参与", () => {
    expect(decideVerdict({ faithfulness: 91, answerRelevancy: 55, contextPrecision: 78, correctness: null })).toEqual(
      { verdict: "low", minMetric: "answerRelevancy", minScore: 55 },
    );
  });

  it("60-79 → weak；≥80 → pass（原型 §7 档位）", () => {
    expect(
      decideVerdict({ faithfulness: 90, answerRelevancy: 79, contextPrecision: 88, correctness: null })
        .verdict,
    ).toBe("weak");
    expect(
      decideVerdict({ faithfulness: 80, answerRelevancy: 95, contextPrecision: 88, correctness: 99 })
        .verdict,
    ).toBe("pass");
  });

  it("三基础指标全 null → unscored（裁判全挂 ≠ 配置很差，不给档位）", () => {
    expect(
      decideVerdict({
        faithfulness: null,
        answerRelevancy: null,
        contextPrecision: null,
        correctness: null,
      }),
    ).toEqual({ verdict: "unscored", minMetric: null, minScore: null });
  });
});

describe("EvalRunWorkerProcessor", () => {
  it("逐条跑：用 resolveForTest（preview=true）解析一次，按 snapshot 顺序跑", async () => {
    const { processor, applications, orchestration } = setup({ snapshot: [c(1), c(2)] });
    await processor.processRun("r1");
    expect(applications.resolveForTest).toHaveBeenCalledTimes(1); // 每 run 一次，不逐条
    expect(orchestration.runForEvaluation.mock.calls.map((call) => call[1])).toEqual([
      "问题 1",
      "问题 2",
    ]);
  });

  it("stop_requested → 收尾 partial，已完成结果保留，未跑用例不写行", async () => {
    const { processor, runs, results } = setup({ snapshot: [c(1), c(2), c(3)], stopAfter: 1 });
    await processor.processRun("r1");
    expect(runs.get("r1")!.status).toBe("partial");
    expect(results.filter((r) => r.runId === "r1")).toHaveLength(1);
    expect(runs.get("r1")!.doneCases).toBe(1);
  });

  it("token 超预算 → budget_stop", async () => {
    const { processor, runs, results } = setup({
      snapshot: [c(1), c(2)],
      tokenBudget: 10,
      usagePerCase: 100,
    });
    await processor.processRun("r1");
    expect(runs.get("r1")!.status).toBe("budget_stop");
    expect(results).toHaveLength(1); // 第 2 条开跑前就熔断
  });

  // ——— QA recheck P1：编排失败绝不能被洗成分数 ————————————————————————
  //
  // 生成失败的两条路径（orchestration.service.ts 首 token 熔断 / infra 失败）都是
  // `yield {type:"error"}` 后 **return，不抛**；runForEvaluation 的收集循环原先只认 token
  // 事件，于是返回 {replyText:"", timedOut:false} —— 与「成功但答案为空」完全同形。
  // worker 当成功 → 把空串喂裁判 → correctness 记 0（"答案是空的"）、faithfulness 记 100
  // （空文本没有可验证主张 → faithfulness.evaluator.ts:58 直接给 100）→ 记分卡**双向**被
  // 假分污染，还标「已评 2/2」满信心。这比 NULL 更糟：NULL 诚实，假分会撒谎。
  // 不变式：**编排没产出答案的用例，绝不送去判分。**
  it("编排失败（yield error 不抛）→ verdict=unscored、分数全 null、带错误原文，且绝不判分", async () => {
    const { processor, results, judge } = setup({ snapshot: [c(1), c(2)], errorOn: [1] });
    await processor.processRun("r1");

    const failed = results.find((r) => r.seq === 1)!;
    expect(failed.verdict).toBe("unscored");
    expect(failed.faithfulness).toBeNull(); // ← 绝不是 100
    expect(failed.answerRelevancy).toBeNull();
    expect(failed.contextPrecision).toBeNull();
    expect(failed.correctness).toBeNull(); // ← 绝不是 0
    expect(failed.minScore).toBeNull();
    expect(failed.error).toContain("生成失败");
    // 最关键：裁判**根本没被调用**——只有第 2 条正常用例调了它。
    expect(judge.scoreOffline).toHaveBeenCalledTimes(1);
    expect(judge.scoreOffline.mock.calls[0][0]).toMatchObject({ question: "问题 2" });
  });

  it("编排「成功」但答案为空 → 同样 unscored 不判分（空答案恒被裁判评成 faithfulness=100）", async () => {
    const { processor, results, judge } = setup({ snapshot: [c(1)], emptyAnswerOn: [1] });
    await processor.processRun("r1");

    const empty = results.find((r) => r.seq === 1)!;
    expect(empty.verdict).toBe("unscored");
    expect(empty.faithfulness).toBeNull();
    expect(empty.correctness).toBeNull();
    expect(empty.error).toBe("编排未产出答案");
    expect(judge.scoreOffline).not.toHaveBeenCalled();
  });

  it("检索兜底（有兜底话术）仍照常判分 —— 兜底是用户真会看到的答案，不是失败", async () => {
    const { processor, results, judge } = setup({ snapshot: [c(1)] });
    await processor.processRun("r1");
    expect(judge.scoreOffline).toHaveBeenCalledTimes(1);
    expect(results.find((r) => r.seq === 1)!.verdict).not.toBe("unscored");
  });

  it("单用例编排超时 → verdict=timeout，分数全 null，run 继续跑下一条", async () => {
    const { processor, results, runs, judge } = setup({ snapshot: [c(1), c(2)], timeoutOn: [1] });
    await processor.processRun("r1");
    const first = results.find((r) => r.seq === 1)!;
    expect(first.verdict).toBe("timeout");
    expect(first.faithfulness).toBeNull();
    expect(first.answerRelevancy).toBeNull();
    expect(first.contextPrecision).toBeNull();
    expect(first.correctness).toBeNull();
    expect(first.minScore).toBeNull();
    expect(judge.scoreOffline).toHaveBeenCalledTimes(1); // 超时条不判分
    expect(runs.get("r1")!.status).toBe("done");
  });

  it("超时也写 previewTraceId —— traceId 恒有值，「trace」链接必须能跳", async () => {
    const { processor, results } = setup({ snapshot: [c(1)], timeoutOn: [1] });
    await processor.processRun("r1");
    expect(results[0].previewTraceId).toBe("trace-1");
  });

  // QA P1：30s 硬编码常量让 4 次真实 run 100% 判超时、一个分都出不来。超时预算改为
  // 注入的配置项——这两条钉死「worker 用的是配置值，不是任何硬编码常量」。
  it("单用例超时预算取自 AppConfigService（离线默认 120s，非在线熔断的 30s）", async () => {
    const { processor, orchestration } = setup({ snapshot: [c(1)] });
    await processor.processRun("r1");
    expect(orchestration.runForEvaluation.mock.calls[0][2]).toMatchObject({ timeoutMs: 120_000 });
  });

  it("env 覆盖后 worker 用覆盖值，超时文案也报同一个值", async () => {
    const { processor, orchestration, results } = setup({
      snapshot: [c(1)],
      caseTimeoutMs: 45_000,
      timeoutOn: [1],
    });
    await processor.processRun("r1");
    expect(orchestration.runForEvaluation.mock.calls[0][2]).toMatchObject({ timeoutMs: 45_000 });
    expect(results[0].error).toBe("编排超时（判定阈值 45000ms）");
  });

  it("配置版本不可用 → run failed", async () => {
    const { processor, runs } = setup({ resolveThrows: true });
    await processor.processRun("r1");
    expect(runs.get("r1")!.status).toBe("failed");
    expect(runs.get("r1")!.error).toContain("配置版本不可用");
  });

  it("抢不到租约 → run 保持 queued 并重新入队", async () => {
    const { processor, runs, queue } = setup({ leaseBusy: true });
    await processor.processRun("r1");
    expect(runs.get("r1")!.status).toBe("queued");
    expect(queue.publish).toHaveBeenCalledWith(EVAL_RUN_JOB, { runId: "r1" }, { retryLimit: 3 });
  });

  it("判定：取非 null 指标最低档；写入结果行的 minMetric/minScore 即 argmin", async () => {
    const { processor, results } = setup({
      snapshot: [c(1)],
      scores: { faithfulness: 91, answerRelevancy: 55, contextPrecision: 78, correctness: null },
    });
    await processor.processRun("r1");
    expect(results[0].verdict).toBe("low"); // 55 < 60
    expect(results[0].minMetric).toBe("answerRelevancy");
    expect(results[0].minScore).toBe(55);
  });

  it("Judge 输入用编排暴露的**真实** chunkId，不合成", async () => {
    const { processor, judge } = setup({ snapshot: [c(1)] });
    await processor.processRun("r1");
    expect(judge.scoreOffline.mock.calls[0][0]).toMatchObject({
      targetTraceId: "trace-1",
      question: "问题 1",
      answer: "回答 1",
      contexts: [{ chunkId: "chunk-1", text: "片段 1", finalScore: 0.9 }],
    });
  });

  it("裁判模型取 run 行上的发起时快照，不读全局在线设置", async () => {
    const { processor, judge } = setup({ snapshot: [c(1)] });
    await processor.processRun("r1");
    expect(judge.scoreOffline.mock.calls[0][1]).toEqual({
      judgeModelId: "44444444-4444-4444-8444-444444444444",
      embeddingModelId: "55555555-5555-4555-8555-555555555555",
    });
  });

  it("tokensUsed = 编排 usage + 裁判 usage（决策 G：只累加已上报部分）", async () => {
    const { processor, runs } = setup({
      snapshot: [c(1)],
      usagePerCase: 30,
      scores: { usage: { inputTokens: 12, outputTokens: 8 } },
    });
    await processor.processRun("r1");
    expect(runs.get("r1")!.tokensUsed).toBe(50);
  });

  it("重试续跑：已落结果行的用例跳过（否则撞唯一索引，3 次重试全白给）", async () => {
    const { processor, orchestration, results } = setup({
      snapshot: [c(1), c(2)],
      runStatus: "running",
      recorded: ["cv-1"],
    });
    await processor.processRun("r1");
    expect(orchestration.runForEvaluation).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.seq)).toEqual([2]);
  });

  it("F5：repeatCount=2 × 1 用例 → 2 行、repeat_index 1..2、done_cases=2", async () => {
    const { processor, results, runs } = setup({ snapshot: [c(1)], repeatCount: 2 });
    await processor.processRun("r1");
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.repeatIndex).sort()).toEqual([1, 2]);
    expect(runs.get("r1")!.doneCases).toBe(2);
  });

  it("F5：重试续跑跳过已录 (caseVersionId, repeatIndex) unit", async () => {
    const { processor, results } = setup({
      snapshot: [c(1)],
      repeatCount: 2,
      runStatus: "running",
      recorded: ["cv-1"], // repeatIndex=1 已录 → 只跑 repeatIndex=2
    });
    await processor.processRun("r1");
    expect(results).toHaveLength(1);
    expect(results[0].repeatIndex).toBe(2);
  });

  it("F2：带 gold 引用的用例回填检索三列；无 gold → 三列 null", async () => {
    const { processor, results } = setup({ snapshot: [c(1), c(2)], goldRefSeqs: [1] });
    await processor.processRun("r1");
    const r1 = results.find((r) => r.seq === 1)!;
    const r2 = results.find((r) => r.seq === 2)!;
    // seq1 的 retrievedHits docId=d1 命中 goldRef d1 → 三列非空。
    expect(r1.contextRecall).toBe(100);
    expect(r1.ndcg5).toBe(100);
    expect(r1.hitRate5).toBe(100);
    // seq2 无 gold → 三列 null。
    expect(r2.contextRecall).toBeNull();
    expect(r2.ndcg5).toBeNull();
    expect(r2.hitRate5).toBeNull();
  });

  it("F2：CHAT 短路（retrievalExecuted=false）→ 检索三列 null，即便有 gold", async () => {
    const { processor, results } = setup({
      snapshot: [c(1)],
      goldRefSeqs: [1],
      noRetrievalOn: [1],
    });
    await processor.processRun("r1");
    expect(results[0].contextRecall).toBeNull();
  });

  it("F2：超时路径也回填检索三列（检索指标不依赖答案）", async () => {
    const { processor, results } = setup({
      snapshot: [c(1)],
      goldRefSeqs: [1],
      timeoutOn: [1],
    });
    await processor.processRun("r1");
    expect(results[0].verdict).toBe("timeout");
    expect(results[0].contextRecall).toBe(100); // 超时但检索列表仍在
  });

  it("F4：citation 分数写入结果行（来自 scoreOffline）", async () => {
    const { processor, results } = setup({
      snapshot: [c(1)],
      scores: { citation: 67 },
    });
    await processor.processRun("r1");
    expect(results[0].citation).toBe(67);
  });

  it("run 已是终态 → 幂等空转（pg-boss 重投递不该重跑一条跑完的 run）", async () => {
    const { processor, orchestration } = setup({ runStatus: "done" });
    const summary = await processor.processRun("r1");
    expect(summary.kind).toBe("already_finished");
    expect(orchestration.runForEvaluation).not.toHaveBeenCalled();
  });
});

// ——— host review 修订：租约必须表达「worker 还活着」，不是「run 开始还没超过 5 分钟」———
describe("EvalRunWorkerProcessor · 租约续期", () => {
  it("逐条用例续租：租约 5 分钟而 run 可能跑更久，不续期会把自己跑成「已放弃」", async () => {
    const { processor, renewCount } = setup({ snapshot: [c(1), c(2), c(3)] });
    await processor.processRun("r1");
    expect(renewCount()).toBe(3); // 每条一次
  });

  it("续租失败（租约被回收或被接管）→ 立刻让位，不再写结果（防两个 worker 同写一条 run）", async () => {
    const { processor, results, runs, queue } = setup({
      snapshot: [c(1), c(2), c(3)],
      leaseLostAfter: 1,
    });
    const out = await processor.processRun("r1");
    expect(out.kind).toBe("lease_busy");
    expect(results).toHaveLength(1); // 只有续租成功那次写了
    expect(runs.get("r1")!.status).not.toBe("done"); // 没有越权收尾
    expect(queue.publish).not.toHaveBeenCalled(); // 失租不重投
  });

  it("markRunning 条件更新不匹配（租约在 acquire 与 markRunning 之间被回收）→ 让位，不跑任何用例", async () => {
    // `tryAcquireLease` → `findRunById` → `resolveForTest` → `markRunning` 之间有两次 DB
    // 往返的真实窗口，回收器可能已把该 run 判死并清空租约。此时必须让位：继续跑会把结果
    // 写进一条 failed run，`finishRunAsOwner` 还会把它翻回 done（而 create 已放行第二个
    // run）——**该路径现已被 15(a) 的租约条件化关闭**：失去租约的 worker 改不动终态。
    const { processor, results, runs } = setup({ snapshot: [c(1), c(2)], markRunningLost: true });
    const out = await processor.processRun("r1");
    expect(out.kind).toBe("lease_busy");
    expect(results).toHaveLength(0); // 一条用例都没跑
    expect(runs.get("r1")!.status).not.toBe("done"); // 没有越权收尾
  });

  it("15(b) recordResult 失租 → 立刻让位，不再跑后续用例、不写终态", async () => {
    const { processor, results, runs, queue } = setup({
      snapshot: [c(1), c(2), c(3)],
      recordResultLostAt: 2, // 第 2 条记录时被回收
    });
    const outcome = await processor.processRun("r1");

    expect(outcome.kind).toBe("lease_busy");
    expect(results).toHaveLength(1); // 第 2 条没写进去
    // 关键：不得继续走到收尾 —— 否则把一条已被回收的 run 覆盖成 done
    expect(runs.get("r1")!.status).toBe("running");
    // 失租**不重投**（与 renewLease 失败同款）：租约已属他人，重投只会空转。
    // 唯一该重投的是 tryAcquireLease 抢不到那一路。
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it("15(a) finishRunAsOwner 失租 → lease_busy，且不改本地 run 状态", async () => {
    const { processor, runs, queue } = setup({ snapshot: [c(1)], finishRunLost: true });
    const outcome = await processor.processRun("r1");

    expect(outcome.kind).toBe("lease_busy");
    expect(runs.get("r1")!.status).toBe("running");
    expect(queue.publish).not.toHaveBeenCalled();
  });
});
