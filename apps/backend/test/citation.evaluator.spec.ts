import { CitationEvaluator } from "../src/modules/evaluations/citation.evaluator";
import type { ModelsService } from "../src/modules/models/models.service";

/**
 * E-W2b F4：Citation Correctness——逐引用 LLM 判定。score = supported 数 / 引用总数 × 100。
 * 无角标/全部越界 → null 不调模型（未评，不写 0）。schema 宽松 + 归一化（020 教训）。
 */

const ctx = (n: number) => ({ chunkId: `c${n}`, text: `context ${n}`, finalScore: 0.9 });
const base = {
  targetTraceId: "a".repeat(32),
  question: "退款政策是什么",
  contexts: [ctx(1), ctx(2), ctx(3)],
};

function models(content: string, usage?: { inputTokens: number; outputTokens: number }) {
  const chat = jest.fn(async () => ({ content, ...(usage ? { usage } : {}) }));
  return { chat } as unknown as ModelsService;
}

describe("CitationEvaluator", () => {
  it("无 [n] 角标 → null 且不调模型（未评，不写 0）", async () => {
    const m = models("{}");
    const result = await new CitationEvaluator(m).score(
      { ...base, answer: "无任何角标的答案" },
      "m-judge",
    );
    expect(result).toBeNull();
    expect((m.chat as jest.Mock).mock.calls.length).toBe(0);
  });

  it("全部越界角标 → null 不调模型", async () => {
    const m = models("{}");
    const result = await new CitationEvaluator(m).score(
      { ...base, answer: "越界引用 [9][10]" }, // contexts 只有 3 条
      "m-judge",
    );
    expect(result).toBeNull();
    expect((m.chat as jest.Mock).mock.calls.length).toBe(0);
  });

  it("3 引用 2 支持 → 67", async () => {
    const m = models(
      JSON.stringify({
        judgments: [
          { n: 1, supported: true, reason: "支持" },
          { n: 2, supported: false, reason: "不支持" },
          { n: 3, supported: true, reason: "支持" },
        ],
      }),
      { inputTokens: 10, outputTokens: 5 },
    );
    const result = await new CitationEvaluator(m).score(
      { ...base, answer: "第一句[1]。第二句[2]。第三句[3]。" },
      "m-judge",
    );
    expect(result).not.toBeNull();
    expect(result!.score).toBe(67);
    expect(result!.evidence.some((e) => e.startsWith("[supported]"))).toBe(true);
    expect(result!.evidence.some((e) => e.startsWith("[unsupported]"))).toBe(true);
    expect(result!.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("裁判吐裸数组（无 judgments 包装）→ 归一化后仍解析", async () => {
    const m = models(
      JSON.stringify([
        { n: 1, supported: true, reason: "ok" },
        { n: 2, supported: true, reason: "ok" },
      ]),
    );
    const result = await new CitationEvaluator(m).score(
      { ...base, answer: "句子[1]，另一句[2]" },
      "m-judge",
    );
    expect(result!.score).toBe(100);
  });

  it("裁判用字段同义词（support/supporting 字符串）→ 归一化收敛", async () => {
    const m = models(
      JSON.stringify({
        judgments: [
          { n: 1, support: "yes", reason: "ok" },
          { n: 2, supporting: "no", reason: "no" },
        ],
      }),
    );
    const result = await new CitationEvaluator(m).score(
      { ...base, answer: "句[1]，句[2]" },
      "m-judge",
    );
    expect(result!.score).toBe(50);
  });
});
