import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { EvalCompareResponse } from "@codecrush/contracts";
import EvalComparePage from "./EvalComparePage";
import * as client from "../../api/client";
import { EvalCompareIncomparableError } from "../../api/client";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, getEvalCompare: vi.fn(), getEvalRuns: vi.fn() };
});

const runSummary = {
  id: "run-a",
  setId: "set-1",
  setName: "售后核心",
  applicationId: "app-1",
  configVersionId: "cv-a",
  configVersionLabel: "v6",
  status: "done" as const,
  overallScore: 80,
  totalCases: 1,
  doneCases: 1,
  repeatCount: 1,
  durationMs: 1000,
  createdAt: "2026-07-13T09:00:00.000Z",
  judgeModelId: "judge-1",
  offlineJudgeVersion: "offline-v2",
  tokensUsed: 1000,
};

function makeResponse(over: Partial<EvalCompareResponse> = {}): EvalCompareResponse {
  return {
    a: runSummary,
    b: { ...runSummary, id: "run-b", configVersionLabel: "v7", overallScore: 84 },
    metrics: [
      { key: "faithfulness", a: 80, b: 84, delta: 4, significant: false },
      { key: "ndcg5", a: 81, b: 81, delta: 0, significant: false },
    ],
    latency: { aP95Ms: 1200, bP95Ms: 1100 },
    tokens: { aAvgPerCase: 600, bAvgPerCase: 620 },
    cases: [
      {
        caseId: "c1",
        seq: 1,
        question: "能开专票吗",
        a: { verdict: "pass", minScore: 82, scores: { faithfulness: 82 }, answer: "旧答案", traceId: "a".repeat(32) },
        b: { verdict: "weak", minScore: 61, scores: { faithfulness: 61 }, answer: "新答案", traceId: "b".repeat(32) },
        regressed: true,
        improved: false,
      },
    ],
    summary: {
      overallDelta: 4,
      improvedCount: 0,
      regressedCount: 1,
      flatCount: 0,
      excludedCount: 0,
      judgeMismatch: false,
    },
    ...over,
  };
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <EvalComparePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(client.getEvalRuns).mockResolvedValue([]);
});

it("AC8-1：Δ 表渲染；significant:false → 「— 无显著差异」不给箭头", async () => {
  vi.mocked(client.getEvalCompare).mockResolvedValue(makeResponse());
  renderAt("/admin/eval/compare?a=run-a&b=run-b");
  await screen.findByText("忠实度");
  // faithfulness Δ=4 但 significant=false → 无显著差异（无绿箭头）。
  expect(screen.getAllByText("— 无显著差异").length).toBeGreaterThan(0);
  expect(screen.queryByText("▲ +4")).not.toBeInTheDocument();
  // NDCG 显示两位小数。
  expect(screen.getAllByText("0.81").length).toBeGreaterThan(0);
});

it("结论横幅：Δ≥3 有变差 → 橙(warning) 文案含回退提示", async () => {
  vi.mocked(client.getEvalCompare).mockResolvedValue(makeResponse());
  renderAt("/admin/eval/compare?a=run-a&b=run-b");
  await waitFor(() =>
    expect(screen.getByText(/综合 \+4 · 可上线，但注意 1 条用例回退/)).toBeInTheDocument(),
  );
});

it("结论横幅：Δ≤-3 → 红(不建议上线)", async () => {
  vi.mocked(client.getEvalCompare).mockResolvedValue(
    makeResponse({ summary: { overallDelta: -5, improvedCount: 0, regressedCount: 2, flatCount: 0, excludedCount: 0, judgeMismatch: false } }),
  );
  renderAt("/admin/eval/compare?a=run-a&b=run-b");
  await waitFor(() => expect(screen.getByText(/综合 -5 · 不建议上线/)).toBeInTheDocument());
});

it("|Δ|<3 → 灰(无显著差异)", async () => {
  vi.mocked(client.getEvalCompare).mockResolvedValue(
    makeResponse({ summary: { overallDelta: 1, improvedCount: 0, regressedCount: 0, flatCount: 1, excludedCount: 0, judgeMismatch: false } }),
  );
  renderAt("/admin/eval/compare?a=run-a&b=run-b");
  await waitFor(() => expect(screen.getByText(/综合 \+1 · 无显著差异/)).toBeInTheDocument());
});

it("AC8-2：题库版本集合不一致 → 红条 + 重跑基线按钮", async () => {
  vi.mocked(client.getEvalCompare).mockRejectedValue(new EvalCompareIncomparableError());
  renderAt("/admin/eval/compare?a=run-a&b=run-b");
  await screen.findByText("两次评测的题库版本不一致，结论不可比");
  expect(screen.getByRole("button", { name: "用当前题库重跑基线" })).toBeInTheDocument();
});

it("judgeMismatch → 灰字提示", async () => {
  vi.mocked(client.getEvalCompare).mockResolvedValue(
    makeResponse({ summary: { overallDelta: 4, improvedCount: 0, regressedCount: 1, flatCount: 0, excludedCount: 0, judgeMismatch: true } }),
  );
  renderAt("/admin/eval/compare?a=run-a&b=run-b");
  await screen.findByText("两次 run 的裁判模型不同，分数可比性弱");
});

it("延迟/Token 黄底行常显", async () => {
  vi.mocked(client.getEvalCompare).mockResolvedValue(makeResponse());
  renderAt("/admin/eval/compare?a=run-a&b=run-b");
  await screen.findByText(/P95 延迟/);
  expect(screen.getByText(/每题均 Token/)).toBeInTheDocument();
});

it("缺 a/b → 选择器态", async () => {
  renderAt("/admin/eval/compare");
  expect(await screen.findByText("选择同一评测集的两个 run 进行对比")).toBeInTheDocument();
});

it("选择一侧后禁用另一评测集的 run", async () => {
  vi.mocked(client.getEvalRuns).mockResolvedValue([
    runSummary,
    { ...runSummary, id: "run-same-set", configVersionLabel: "v7" },
    { ...runSummary, id: "run-other-set", setId: "set-2", setName: "其他评测集" },
  ]);
  renderAt("/admin/eval/compare?a=run-a");

  const candidate = await screen.findByRole("combobox", { name: "候选 run" });
  fireEvent.mouseDown(candidate);
  expect(await screen.findByTitle("其他评测集 · v6")).toHaveAttribute("aria-disabled", "true");
});
