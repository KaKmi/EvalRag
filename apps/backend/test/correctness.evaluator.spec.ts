import { CorrectnessEvaluator } from "../src/modules/evaluations/correctness.evaluator";
import type { ModelsService } from "../src/modules/models/models.service";

/**
 * 018 决策 D：gold 要点比对（原型 §7「正确率显示 gold 要点比对(一致/缺失/矛盾)」）。
 * score = hits / points × 100；矛盾与缺失都不计入一致数。
 */

const base = {
  targetTraceId: "a".repeat(32),
  question: "课程可以退款吗",
  answer: "7 天内无理由退，已开课按比例",
  contexts: [],
};

/** 只桩 chat()，返回结构化 JSON —— 与 faithfulness.evaluator.spec 同款。 */
function models(content: string, usage?: { inputTokens: number; outputTokens: number }) {
  return {
    chat: jest.fn(async () => ({ content, ...(usage ? { usage } : {}) })),
  } as unknown as ModelsService;
}

const points = (
  ...rows: Array<[string, "hit" | "missing" | "contradicted"]>
) => JSON.stringify({ points: rows.map(([point, status]) => ({ point, status, reason: `${point}:${status}` })) });

describe("CorrectnessEvaluator", () => {
  it("按 gold 要点比对计分：2/3 一致 → 67", async () => {
    const m = models(
      points(["7 天内无理由退", "hit"], ["已开课按比例", "hit"], ["赠品课不退", "missing"]),
    );
    const result = await new CorrectnessEvaluator(m).score(
      { ...base, goldPoints: ["7 天内无理由退", "已开课按比例", "赠品课不退"] },
      "m-judge",
    );
    expect(result.score).toBe(67);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("矛盾要点不计入一致数", async () => {
    const m = models(points(["赠品课不退", "contradicted"]));
    const result = await new CorrectnessEvaluator(m).score(
      { ...base, goldPoints: ["赠品课不退"] },
      "m-judge",
    );
    expect(result.score).toBe(0);
  });

  it("要点全中 → 100", async () => {
    const m = models(points(["a", "hit"], ["b", "hit"]));
    const result = await new CorrectnessEvaluator(m).score({ ...base, goldPoints: ["a", "b"] }, "m-judge");
    expect(result.score).toBe(100);
  });

  it("空 gold → 不调模型（调用方保证不会走到，防御性返回 0）", async () => {
    const m = models(points(["never", "hit"]));
    const result = await new CorrectnessEvaluator(m).score({ ...base, goldPoints: [] }, "m-judge");
    expect(m.chat).not.toHaveBeenCalled();
    expect(result.score).toBe(0);
  });

  it("透传 usage（决策 G）", async () => {
    const m = models(points(["a", "hit"]), { inputTokens: 12, outputTokens: 4 });
    const result = await new CorrectnessEvaluator(m).score({ ...base, goldPoints: ["a"] }, "m-judge");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 4 });
  });

  it("模型吐非法 JSON → 重试一次后仍败则抛（withJudgeRetry，MAX_ATTEMPTS=2）", async () => {
    const m = models("not json at all");
    await expect(
      new CorrectnessEvaluator(m).score({ ...base, goldPoints: ["a"] }, "m-judge"),
    ).rejects.toThrow(/correctness/);
    expect((m.chat as jest.Mock).mock.calls).toHaveLength(2); // 首次 + 重试一次
  });

  it("temperature=0 且走结构化输出（与三个既有 evaluator 同款）", async () => {
    const m = models(points(["a", "hit"]));
    await new CorrectnessEvaluator(m).score({ ...base, goldPoints: ["a"] }, "m-judge");
    const opts = (m.chat as jest.Mock).mock.calls[0][2];
    expect(opts.temperature).toBe(0);
    expect(opts.structuredOutput).toBeDefined();
  });
});
