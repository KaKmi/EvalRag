import { EvaluationWorkerProcessor } from "../src/modules/evaluations/evaluation-worker.processor";
import {
  ONLINE_EVALUATION_JOB,
  ONLINE_EVALUATION_WORKER,
} from "../src/platform/queue/queue.constants";

const fixedNow = new Date("2026-07-15T02:00:00.000Z");
const cursorAt0100 = {
  lastTs: new Date("2026-07-15T01:00:00.000Z"),
  lastTraceId: "0".repeat(32),
  dailyDate: "2026-07-15",
  dailyCount: 0,
};
const enabledSettings = {
  enabled: true,
  sampleRate: 0.1,
  judgeModelId: "judge-1",
  embeddingModelId: "embed-1",
  dailyCap: 500,
  judgeVersion: "online-v1",
};
const makeRisk = (index: number) => ({
  traceId: index.toString(16).padStart(32, "0"),
  startTime: new Date(`2026-07-15T01:${String(30 + index).padStart(2, "0")}:00.000Z`),
  agentId: "app-1",
  generationModel: "qwen",
  status: "fallback" as const,
  noCitations: true,
  confidence: 0.2,
  retrievalChunks: [],
});
const evaluationInput = {
  targetTraceId: makeRisk(0).traceId,
  question: "refund deadline",
  answer: "seven days",
  contexts: [],
};
const scores = {
  faithfulness: 90,
  answerRelevancy: 85,
  contextPrecision: 0,
  evidence: {
    faithfulness: ["supported"],
    answerRelevancy: ["relevant"],
    contextPrecision: ["no context"],
  },
};

const makeRepoMock = () => ({
  tryAcquireLease: jest.fn().mockResolvedValue(true),
  getSettings: jest.fn().mockResolvedValue(enabledSettings),
  getOrCreateWatermark: jest.fn().mockResolvedValue(cursorAt0100),
  finishCycle: jest.fn().mockResolvedValue(undefined),
  releaseLease: jest.fn().mockResolvedValue(undefined),
  recordFailure: jest.fn().mockResolvedValue(undefined),
});
const makeClickHouseMock = () => ({
  listCandidates: jest.fn().mockResolvedValue([]),
  findExisting: jest.fn().mockResolvedValue(undefined),
});
const makeInputMock = () => ({
  assemble: jest
    .fn()
    .mockResolvedValue({ status: "ready", input: evaluationInput, missingChunkIds: [] }),
});
const makeJudgeMock = () => ({ score: jest.fn().mockResolvedValue(scores) });
const makeEmitterMock = () => ({
  emitSuccess: jest.fn().mockResolvedValue(undefined),
  emitFailure: jest.fn().mockResolvedValue(undefined),
});
const makeModelsMock = () => ({
  get: jest.fn(async (id: string) =>
    id === "judge-1"
      ? { id, type: "llm", enabled: true }
      : { id, type: "embedding", enabled: true },
  ),
});

describe("EvaluationWorkerProcessor", () => {
  let repo: ReturnType<typeof makeRepoMock>;
  let clickhouse: ReturnType<typeof makeClickHouseMock>;
  let input: ReturnType<typeof makeInputMock>;
  let judge: ReturnType<typeof makeJudgeMock>;
  let emitter: ReturnType<typeof makeEmitterMock>;
  let queue: {
    subscribe: jest.Mock;
    schedule: jest.Mock;
  };
  let models: ReturnType<typeof makeModelsMock>;
  let config: { onlineEvalBackfillWindowHours: number };
  let subscribedHandler: (data: unknown) => Promise<void>;
  let processor: EvaluationWorkerProcessor;

  beforeEach(() => {
    repo = makeRepoMock();
    clickhouse = makeClickHouseMock();
    input = makeInputMock();
    judge = makeJudgeMock();
    emitter = makeEmitterMock();
    queue = {
      subscribe: jest.fn(async (_name: string, handler: (data: unknown) => Promise<void>) => {
        subscribedHandler = handler;
      }),
      schedule: jest.fn().mockResolvedValue(undefined),
    };
    models = makeModelsMock();
    config = { onlineEvalBackfillWindowHours: 24 };
    processor = new EvaluationWorkerProcessor(
      queue,
      repo,
      clickhouse,
      input,
      judge,
      emitter,
      models,
      config as never,
    );
  });

  it("uses a five-minute upper bound, emits success and advances the composite cursor", async () => {
    const candidate = makeRisk(0);
    clickhouse.listCandidates.mockResolvedValue([candidate]);
    await processor.processCycle("online-quality-v1", fixedNow);
    expect(clickhouse.listCandidates).toHaveBeenCalledWith(
      cursorAt0100,
      new Date("2026-07-15T01:55:00.000Z"),
      500,
    );
    expect(emitter.emitSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate,
        settings: expect.objectContaining({ judgeVersion: "online-v1" }),
      }),
    );
    expect(repo.finishCycle).toHaveBeenCalledWith(
      "online-quality-v1",
      expect.any(String),
      expect.objectContaining({ lastTraceId: candidate.traceId, evaluatedIncrement: 1 }),
    );
  });

  it("stops after five consecutive judge failures and advances only through the fifth", async () => {
    const candidates = Array.from({ length: 6 }, (_, index) => makeRisk(index));
    clickhouse.listCandidates.mockResolvedValue(candidates);
    judge.score.mockRejectedValue(new Error("judge down"));
    const cycle = await processor.processCycle("online-quality-v1", fixedNow);
    expect(judge.score).toHaveBeenCalledTimes(5);
    expect(emitter.emitFailure).toHaveBeenCalledTimes(5);
    expect(cycle.outcomes.map((item) => item.kind)).toEqual([
      "processed_failed",
      "processed_failed",
      "processed_failed",
      "processed_failed",
      "processed_failed",
      "circuit_deferred",
    ]);
    expect(cycle.cursor).toEqual({
      lastTs: candidates[4].startTime,
      lastTraceId: candidates[4].traceId,
    });
    expect(repo.finishCycle).toHaveBeenCalledWith(
      "online-quality-v1",
      expect.any(String),
      expect.objectContaining({ consecutiveFailures: 5, lastTraceId: candidates[4].traceId }),
    );
  });

  // 空轮不该改写裁判的健康状态：finishCycle 曾无条件写 `?? 0` / `?? null`，而空轮也走
  // finishCycle ⇒ 任何一个无所事事的轮次都会把「上次为什么失败」擦干净。018 §12 缺口 20 的
  // 排除论证 ③ 正是据这两个字段排除「worker 失败」，而它们只描述最后一轮。
  it("leaves judge health untouched on a cycle that never called the judge", async () => {
    clickhouse.listCandidates.mockResolvedValue([]);
    await processor.processCycle("online-quality-v1", fixedNow);
    const [, , finish] = repo.finishCycle.mock.calls[0];
    expect(finish).not.toHaveProperty("consecutiveFailures");
    expect(finish).not.toHaveProperty("lastError");
  });

  it("leaves judge health untouched when every candidate is sampled out", async () => {
    repo.getSettings.mockResolvedValue({ ...enabledSettings, sampleRate: 0.0001 });
    const normal = {
      ...makeRisk(0),
      status: "success" as const,
      noCitations: false,
      confidence: 0.9,
    };
    clickhouse.listCandidates.mockResolvedValue([normal]);
    const cycle = await processor.processCycle("online-quality-v1", fixedNow);
    expect(cycle.outcomes.map((item) => item.kind)).toEqual(["sampled_out"]);
    expect(judge.score).not.toHaveBeenCalled();
    // 500 条全被抽样刷掉也没碰过裁判 —— 判据是「动没动裁判」，不是「有没有候选」
    const [, , finish] = repo.finishCycle.mock.calls[0];
    expect(finish).not.toHaveProperty("consecutiveFailures");
  });

  it("reports judge health when the judge actually ran", async () => {
    clickhouse.listCandidates.mockResolvedValue([makeRisk(0)]);
    await processor.processCycle("online-quality-v1", fixedNow);
    expect(repo.finishCycle).toHaveBeenCalledWith(
      "online-quality-v1",
      expect.any(String),
      expect.objectContaining({ consecutiveFailures: 0, lastError: null }),
    );
  });

  it.each([
    ["success with citations", { status: "success", noCitations: false, confidence: 0.9 }, false],
    ["low-confidence success", { status: "success", noCitations: false, confidence: 0.2 }, false],
    ["fallback", { status: "fallback", noCitations: false, confidence: 0.2 }, true],
    ["failed", { status: "failed", noCitations: false, confidence: 0.2 }, true],
    ["no citations", { status: "success", noCitations: true, confidence: 0.9 }, true],
  ] as const)("sets the faithfulness gate for %s", async (_label, patch, skipFaithfulness) => {
    repo.getSettings.mockResolvedValue({ ...enabledSettings, sampleRate: 1 });
    const candidate = { ...makeRisk(0), ...patch };
    clickhouse.listCandidates.mockResolvedValue([candidate]);

    await processor.processCycle("online-quality-v1", fixedNow);

    expect(judge.score).toHaveBeenCalledWith(
      evaluationInput,
      { judgeModelId: "judge-1", embeddingModelId: "embed-1" },
      { skipFaithfulness },
    );
    expect(emitter.emitSuccess).toHaveBeenCalledTimes(1);
    expect(repo.finishCycle).toHaveBeenCalledWith(
      "online-quality-v1",
      expect.any(String),
      expect.objectContaining({ consecutiveFailures: 0, evaluatedIncrement: 1 }),
    );
  });

  // 冷启动播种点只在水位线那行不存在时生效，而**行是在 tryAcquireLease 里诞生的** ——
  // 只把 seedFrom 传给 getOrCreateWatermark 是够不着的。
  it.each([
    ["默认 24 小时（017:26 原行为）", 24, new Date("2026-07-14T02:00:00.000Z")],
    ["0 = 只评此后的新问答", 0, fixedNow],
    ["-1 = 回看全部历史", -1, new Date(0)],
  ])(
    "seeds a fresh watermark per ONLINE_EVAL_BACKFILL_WINDOW_HOURS: %s",
    async (_l, hours, seed) => {
      config.onlineEvalBackfillWindowHours = hours;
      clickhouse.listCandidates.mockResolvedValue([]);
      await processor.processCycle("online-quality-v1", fixedNow);
      expect(repo.tryAcquireLease).toHaveBeenCalledWith(
        "online-quality-v1",
        expect.any(String),
        fixedNow,
        20 * 60_000,
        seed,
      );
      expect(repo.getOrCreateWatermark).toHaveBeenCalledWith("online-quality-v1", fixedNow, seed);
    },
  );

  it("does not query candidates when disabled or lease is owned elsewhere", async () => {
    repo.getSettings.mockResolvedValueOnce({ ...enabledSettings, enabled: false });
    expect((await processor.processCycle("online-quality-v1", fixedNow)).status).toBe("disabled");
    repo.tryAcquireLease.mockResolvedValueOnce(false);
    expect((await processor.processCycle("online-quality-v1", fixedNow)).status).toBe("lease_busy");
    expect(clickhouse.listCandidates).not.toHaveBeenCalled();
  });

  it.each([
    ["judge-1", new Error("not found")],
    ["judge-1", { id: "judge-1", type: "llm", enabled: false }],
    ["embed-1", { id: "embed-1", type: "llm", enabled: true }],
  ] as const)(
    "pauses before acquiring a lease when model %s is unavailable",
    async (id, result) => {
      models.get.mockImplementation(async (requested: string) => {
        if (requested !== id)
          return requested === "judge-1"
            ? { id: requested, type: "llm", enabled: true }
            : { id: requested, type: "embedding", enabled: true };
        if (result instanceof Error) throw result;
        return result;
      });
      expect((await processor.processCycle("online-quality-v1", fixedNow)).status).toBe(
        "model_unavailable",
      );
      expect(repo.recordFailure).toHaveBeenCalledWith(
        "online-quality-v1",
        "ModelUnavailable",
        expect.stringContaining(id),
      );
      expect(repo.tryAcquireLease).not.toHaveBeenCalled();
    },
  );

  it("skips an existing target/version without calling the judge", async () => {
    clickhouse.listCandidates.mockResolvedValue([makeRisk(0)]);
    clickhouse.findExisting.mockResolvedValue({ targetTraceId: makeRisk(0).traceId });
    const cycle = await processor.processCycle("online-quality-v1", fixedNow);
    expect(judge.score).not.toHaveBeenCalled();
    expect(cycle.outcomes[0].kind).toBe("already_scored");
  });

  it("reserves the last daily slot for a later risk candidate", async () => {
    repo.getOrCreateWatermark.mockResolvedValue({ ...cursorAt0100, dailyCount: 499 });
    repo.getSettings.mockResolvedValue({ ...enabledSettings, sampleRate: 1 });
    const normal = {
      ...makeRisk(0),
      status: "success" as const,
      noCitations: false,
      confidence: 0.9,
    };
    const risk = makeRisk(1);
    clickhouse.listCandidates.mockResolvedValue([normal, risk]);
    const cycle = await processor.processCycle("online-quality-v1", fixedNow);
    expect(cycle.outcomes.map((item) => item.kind)).toEqual(["quota_skipped_normal", "success"]);
    expect(judge.score).toHaveBeenCalledTimes(1);
    expect(cycle.cursor?.lastTraceId).toBe(risk.traceId);
  });

  it("releases its lease when candidate loading throws", async () => {
    clickhouse.listCandidates.mockRejectedValue(new Error("clickhouse down"));
    await expect(processor.processCycle("online-quality-v1", fixedNow)).rejects.toThrow(
      "clickhouse down",
    );
    expect(repo.releaseLease).toHaveBeenCalled();
  });

  it("subscribes before scheduling and records a bounded-retry infrastructure failure", async () => {
    await processor.onModuleInit();
    expect(queue.subscribe).toHaveBeenCalledWith(ONLINE_EVALUATION_JOB, expect.any(Function));
    expect(queue.schedule).toHaveBeenCalledWith(
      ONLINE_EVALUATION_JOB,
      "*/15 * * * *",
      { workerName: ONLINE_EVALUATION_WORKER },
      { tz: "UTC", key: ONLINE_EVALUATION_WORKER, retryLimit: 1 },
    );
    expect(queue.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      queue.schedule.mock.invocationCallOrder[0],
    );
    clickhouse.listCandidates.mockRejectedValue(new Error("clickhouse down"));
    await expect(subscribedHandler({ workerName: ONLINE_EVALUATION_WORKER })).rejects.toThrow(
      "clickhouse down",
    );
    expect(repo.recordFailure).toHaveBeenCalledWith(
      ONLINE_EVALUATION_WORKER,
      "Error",
      "clickhouse down",
    );
    expect(repo.releaseLease).toHaveBeenCalled();
  });
});
