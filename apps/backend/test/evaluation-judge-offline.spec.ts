import { EvaluationJudgeService } from "../src/modules/evaluations/evaluation-judge.service";
import type {
  EvaluationInput,
  EvaluationModelIds,
} from "../src/modules/evaluations/evaluation.types";

/**
 * 018 决策 D：`scoreOffline` 是**单指标隔离**语义（原型 §6：单指标失败记「未评」，
 * 不记 0 分、不拖累其余），与 `score()` 的**整体失败**在线不变式（017:39）相反。
 * 故 `scoreOffline` 绝不复用 `score()`——本文件同时钉死两者的语义差异。
 */

const input: EvaluationInput = {
  targetTraceId: "a".repeat(32),
  question: "课程可以退款吗",
  answer: "7 天内无理由退",
  contexts: [{ chunkId: "chunk-1", text: "退款政策...", finalScore: 0.9 }],
};
const modelIds: EvaluationModelIds = { judgeModelId: "m-judge", embeddingModelId: "m-embed" };

const ok = (score: number, evidence: string[] = ["ok"]) => ({
  score: async () => ({ score, evidence }) as never,
});
const boom = () => ({
  score: async () => {
    throw new Error("judge down");
  },
});
const unscored = () => ({ score: async () => null });

describe("EvaluationJudgeService.scoreOffline（离线：单指标隔离）", () => {
  it("单指标失败 → 该指标 null，其余照常出分（绝不写 0）", async () => {
    const judge = new EvaluationJudgeService(
      ok(91) as never,
      boom() as never,
      ok(78) as never,
      ok(82) as never,
    );
    const out = await judge.scoreOffline(input, modelIds, ["7 天内无理由退"]);
    expect(out.faithfulness).toBe(91);
    expect(out.answerRelevancy).toBeNull(); // 未评，不是 0
    expect(out.contextPrecision).toBe(78);
    expect(out.correctness).toBe(82);
  });

  it("F4：citation 加为第 5 个 allSettled 项——拒绝时其余四项不受影响，citation 记 null", async () => {
    const judge = new EvaluationJudgeService(
      ok(91) as never,
      ok(88) as never,
      ok(78) as never,
      ok(82) as never,
      boom() as never, // citation 裁判挂
    );
    const out = await judge.scoreOffline(input, modelIds, ["7 天内无理由退"]);
    expect(out.faithfulness).toBe(91);
    expect(out.answerRelevancy).toBe(88);
    expect(out.citation).toBeNull(); // 未评，不是 0
  });

  it("F4：4 参构造（不传 citation）不编译失败且 scoreOffline citation 恒 null", async () => {
    const judge = new EvaluationJudgeService(
      ok(90) as never,
      ok(90) as never,
      ok(90) as never,
      ok(90) as never,
    );
    const out = await judge.scoreOffline(input, modelIds, ["要点"]);
    expect(out.citation).toBeNull();
  });

  it("F4：citation 出分 → 进 scoreOffline 返回值", async () => {
    const judge = new EvaluationJudgeService(
      ok(90) as never,
      ok(90) as never,
      ok(90) as never,
      unscored() as never,
      ok(67) as never,
    );
    const out = await judge.scoreOffline(input, modelIds, []);
    expect(out.citation).toBe(67);
  });

  it("全部裁判失败 → 四个指标全 null（一个 0 都不写）", async () => {
    const judge = new EvaluationJudgeService(
      boom() as never,
      boom() as never,
      boom() as never,
      boom() as never,
    );
    const out = await judge.scoreOffline(input, modelIds, ["要点"]);
    expect(out.faithfulness).toBeNull();
    expect(out.answerRelevancy).toBeNull();
    expect(out.contextPrecision).toBeNull();
    expect(out.correctness).toBeNull();
    expect(Object.values(out.evidence).flat()).toHaveLength(0);
  });

  it("goldPoints 为空 → 不调 correctness，correctness=null", async () => {
    let called = false;
    const judge = new EvaluationJudgeService(
      ok(90, []) as never,
      ok(90, []) as never,
      ok(90, []) as never,
      {
        score: async () => {
          called = true;
          return { score: 1, evidence: [] } as never;
        },
      } as never,
    );
    const out = await judge.scoreOffline(input, modelIds, []);
    expect(called).toBe(false);
    expect(out.correctness).toBeNull();
  });

  it("evidence 只收评出来的指标（失败指标无键）", async () => {
    const judge = new EvaluationJudgeService(
      ok(91, ["忠实理由"]) as never,
      boom() as never,
      ok(78, ["精确理由"]) as never,
      ok(82, ["正确理由"]) as never,
    );
    const out = await judge.scoreOffline(input, modelIds, ["要点"]);
    expect(out.evidence.faithfulness).toEqual(["忠实理由"]);
    expect(out.evidence.answerRelevancy).toBeUndefined();
    expect(out.evidence.correctness).toEqual(["正确理由"]);
  });

  it("faithfulness fulfilled-null → 仅该指标未评，其余分数与 evidence 保留", async () => {
    const judge = new EvaluationJudgeService(
      unscored() as never,
      ok(88, ["相关"]) as never,
      ok(78, ["精确"]) as never,
      ok(82, ["正确"]) as never,
    );
    const out = await judge.scoreOffline(input, modelIds, ["要点"]);
    expect(out).toMatchObject({
      faithfulness: null,
      answerRelevancy: 88,
      contextPrecision: 78,
      correctness: 82,
    });
    expect(out.evidence).not.toHaveProperty("faithfulness");
    expect(out.evidence.answerRelevancy).toEqual(["相关"]);
  });

  it("usage 累加各裁判已上报的部分；缺失计 0（决策 G 的尽力而为口径）", async () => {
    const withUsage = (score: number, inputTokens: number, outputTokens: number) => ({
      score: async () => ({ score, evidence: [], usage: { inputTokens, outputTokens } }) as never,
    });
    const judge = new EvaluationJudgeService(
      withUsage(90, 10, 5) as never,
      ok(90) as never, // 无 usage → 计 0，不猜
      withUsage(90, 7, 3) as never,
      withUsage(90, 1, 1) as never,
    );
    const out = await judge.scoreOffline(input, modelIds, ["要点"]);
    expect(out.usage).toEqual({ inputTokens: 18, outputTokens: 9 });
  });

  it("第 4 参缺省（E-W1 的 3 参正位构造）+ 有 goldPoints → correctness 记 null，不崩", async () => {
    // 防御性：DI 恒注入 correctness，此路径不该发生；但绝不能因此抛错拖垮整个 run。
    const judge = new EvaluationJudgeService(ok(91) as never, ok(88) as never, ok(78) as never);
    const out = await judge.scoreOffline(input, modelIds, ["要点"]);
    expect(out.correctness).toBeNull();
    expect(out.faithfulness).toBe(91);
  });
});

describe("EvaluationJudgeService.score（在线：整体失败不变式 017:39 —— 一行不许动）", () => {
  it("任一 evaluator 失败 → 整条 reject（不聚合部分分数）", async () => {
    const judge = new EvaluationJudgeService(
      ok(91, []) as never,
      boom() as never,
      ok(78, []) as never,
      ok(82, []) as never,
    );
    await expect(judge.score(input, modelIds)).rejects.toThrow();
  });

  it("全部成功 → 返回三指标（correctness 不进在线结果）", async () => {
    const judge = new EvaluationJudgeService(
      ok(91, ["a"]) as never,
      ok(88, ["b"]) as never,
      ok(78, ["c"]) as never,
      ok(82, ["d"]) as never,
    );
    const out = await judge.score(input, modelIds);
    expect(out).toEqual({
      faithfulness: 91,
      answerRelevancy: 88,
      contextPrecision: 78,
      evidence: { faithfulness: ["a"], answerRelevancy: ["b"], contextPrecision: ["c"] },
    });
    expect("correctness" in out).toBe(false);
  });
});
