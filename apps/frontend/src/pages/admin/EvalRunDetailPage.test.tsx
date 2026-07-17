import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { EvalRunReport, EvalRunResult } from "@codecrush/contracts";
import * as api from "../../api/client";
import EvalRunDetailPage from "./EvalRunDetailPage";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return { ...actual, getEvalRunReport: vi.fn(), stopEvalRun: vi.fn() };
});
vi.mock("antd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("antd")>();
  return { ...actual, message: { error: vi.fn(), success: vi.fn() } };
});

const TRACE = "a".repeat(32);

const result = (over: Partial<EvalRunResult> = {}): EvalRunResult => ({
  seq: 1,
  caseId: "case-1",
  caseVersion: 1,
  question: "课程可以退款吗",
  faithfulness: 96,
  answerRelevancy: 93,
  contextPrecision: 90,
  correctness: 95,
  minMetric: "contextPrecision",
  minScore: 90,
  verdict: "pass",
  evidence: { faithfulness: ["第 1 条主张有依据"] },
  previewTraceId: TRACE,
  answer: "7 天内无理由退",
  durationMs: 1200,
  error: null,
  ...over,
});

const aggregate = (value: number | null, scoredCount = 2, total = 2) => ({
  value,
  scoredCount,
  total,
});

type Overrides = {
  run?: Partial<EvalRunReport["run"]>;
  scorecard?: Partial<EvalRunReport["scorecard"]>;
  results?: EvalRunResult[];
  skipped?: EvalRunReport["skipped"];
};

function report(over: Overrides = {}): EvalRunReport {
  return {
    run: {
      id: "run-1",
      setId: "set-1",
      setName: "售后核心 50 题",
      applicationId: "app-1",
      configVersionId: "ver-7",
      configVersionLabel: "v7",
      status: "done",
      overallScore: 82,
      totalCases: 2,
      doneCases: 2,
      durationMs: 192_000,
      createdAt: "2026-07-14T06:20:00.000Z",
      judgeModelId: "judge-1",
      offlineJudgeVersion: "offline-v1",
      tokenBudget: 500_000,
      tokensUsed: 176_000,
      startedAt: "2026-07-14T06:20:01.000Z",
      finishedAt: "2026-07-14T06:23:13.000Z",
      error: null,
      ...over.run,
    },
    scorecard: {
      retrieval: { contextPrecision: aggregate(78) },
      generation: {
        faithfulness: aggregate(91),
        answerRelevancy: aggregate(88),
        correctness: aggregate(82),
      },
      passCount: 1,
      weakCount: 0,
      lowCount: 1,
      timeoutCount: 0,
      unscoredCount: 0,
      skippedCount: 0,
      ...over.scorecard,
    },
    results: over.results ?? [result()],
    skipped: over.skipped ?? [],
  };
}

function renderReport(over: Overrides = {}) {
  vi.mocked(api.getEvalRunReport).mockResolvedValue(report(over));
  render(
    <MemoryRouter initialEntries={["/admin/eval/runs/run-1"]}>
      <Routes>
        <Route path="/admin/eval/runs/:runId" element={<EvalRunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return vi.mocked(api.getEvalRunReport);
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("默认按最差指标升序（坏的浮顶）", async () => {
  renderReport({
    results: [
      result({ seq: 1 }),
      result({
        seq: 7,
        caseId: "case-7",
        question: "课程有效期是终身吗",
        faithfulness: 41,
        answerRelevancy: 79,
        contextPrecision: 66,
        correctness: 38,
        minMetric: "correctness",
        minScore: 38,
        verdict: "low",
      }),
    ],
  });
  const cells = await screen.findAllByTestId("cell-faithfulness");
  // 低分用例（最差指标 38）排在通过用例（最差指标 90）之前
  expect(cells[0]).toHaveTextContent("41");
  expect(cells[1]).toHaveTextContent("96");
});

it("点记分卡指标 → 逐用例表按该指标升序", async () => {
  renderReport({
    results: [
      // 忠实度更低、但最差指标（正确率 20）更高 → 默认排序在后，按忠实度排序后浮顶
      result({ seq: 1, faithfulness: 30, correctness: 90, minMetric: "faithfulness", minScore: 30 }),
      result({ seq: 2, caseId: "case-2", faithfulness: 99, correctness: 20, minMetric: "correctness", minScore: 20 }),
    ],
  });
  const before = await screen.findAllByTestId("cell-faithfulness");
  expect(before[0]).toHaveTextContent("99");
  fireEvent.click(screen.getByTestId("scorecard-faithfulness"));
  await waitFor(() => expect(screen.getAllByTestId("cell-faithfulness")[0]).toHaveTextContent("30"));
});

it("未评指标显示「—」而不是 0", async () => {
  renderReport({
    results: [result({ answerRelevancy: null, verdict: "unscored", evidence: {} })],
  });
  const cell = await screen.findByTestId("cell-answerRelevancy");
  expect(cell).toHaveTextContent("—");
  expect(cell).not.toHaveTextContent("0");
});

it("检索层未实现指标显示「—」+「未标 gold docs」注", async () => {
  renderReport();
  // W2b 的 4 项（Context Recall / NDCG@5 / 命中率@5 / Citation）：不实现也不隐藏
  const notes = await screen.findAllByText("未标 gold docs");
  expect(notes).toHaveLength(4);
  expect(await screen.findByText("Context Recall")).toBeInTheDocument();
  expect(screen.getByText("Citation")).toBeInTheDocument();
  // 已实现的 Context Precision 仍显示真实分数
  expect(screen.getByTestId("scorecard-contextPrecision")).toHaveTextContent("78");
});

it("记分卡未评均值显示「—」而不是 0", async () => {
  renderReport({
    scorecard: { generation: { faithfulness: aggregate(null, 0), answerRelevancy: aggregate(88), correctness: aggregate(82) } },
  });
  const cell = await screen.findByTestId("scorecard-faithfulness");
  expect(cell).toHaveTextContent("—");
  expect(cell).not.toHaveTextContent("0");
});

it("终态不再轮询", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const fetchSpy = renderReport({ run: { status: "done" } });
    await screen.findByText("售后核心 50 题", { exact: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("运行中每 3s 轮询一次进度", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const fetchSpy = renderReport({ run: { status: "running", doneCases: 23, totalCases: 50 } });
    expect(await screen.findByText(/运行中 · 23\/50/)).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("非 done 态显示状态横幅说明原因", async () => {
  renderReport({ run: { status: "budget_stop", doneCases: 30, totalCases: 50 } });
  // 横幅（非状态 tag）说明原因：预算额度 + 已完成进度
  const banner = await screen.findByRole("alert");
  expect(within(banner).getByText(/预算中断（500k）· 已完成 30\/50/)).toBeInTheDocument();
});

it("失败态横幅透出错误信息", async () => {
  renderReport({ run: { status: "failed", error: "配置版本不可用" } });
  expect(await screen.findByText("配置版本不可用")).toBeInTheDocument();
});

it("停止 Popconfirm 文案照抄原型 §19.2", async () => {
  renderReport({ run: { status: "running", doneCases: 23, totalCases: 50 } });
  // antd 给「两个汉字」按钮插空格 → 用宽松匹配（同 QualityPage.test.tsx 的 /保\s*存/）
  fireEvent.click(await screen.findByRole("button", { name: /停\s*止/ }));
  expect(
    await screen.findByText("停止后已完成的 23 条保留，未运行的不再执行？"),
  ).toBeInTheDocument();
});

it("未跑用例渲染为灰行且指标全「—」", async () => {
  renderReport({
    run: { status: "partial", doneCases: 1, totalCases: 2 },
    scorecard: { skippedCount: 1 },
    skipped: [{ seq: 2, caseId: "case-2", caseVersion: 1, question: "能开专票吗" }],
  });
  expect(await screen.findByText("能开专票吗")).toBeInTheDocument();
  expect(screen.getByText("未跑")).toBeInTheDocument();
  expect(await screen.findByText(/手动停止，已完成 1\/2/)).toBeInTheDocument();
  // 未跑用例沉底，且四个指标都不显示 0
  const cells = screen.getAllByTestId("cell-correctness");
  expect(cells[cells.length - 1]).toHaveTextContent("—");
});

it("判分依据抽屉逐指标展示证据，未评指标说明不计入均值", async () => {
  renderReport({ results: [result({ correctness: null, evidence: { faithfulness: ["[hit] 7 天内无理由退 —— 一致"] } })] });
  fireEvent.click(await screen.findByRole("button", { name: "判分依据" }));
  expect(await screen.findByText("7 天内无理由退 —— 一致")).toBeInTheDocument();
  expect(screen.getByText("一致")).toBeInTheDocument();
  // 未评的是 correctness（分数为 NULL）——「未评」判据是分数为 NULL，不是 evidence 键缺失
  expect(
    screen.getByText("该指标未评——裁判失败/超时/无 gold 可对照，不计入均值"),
  ).toBeInTheDocument();
  // 有分但本次没返回依据的指标不能被说成「未评」
  expect(screen.getAllByText("本次未返回判分依据").length).toBeGreaterThan(0);
});

it("trace 链接指向 preview trace 详情", async () => {
  renderReport();
  const link = await screen.findByRole("link", { name: "trace" });
  expect(link).toHaveAttribute("href", `/admin/traces/${TRACE}`);
});

// QA P3-4：任何加载失败都渲染「评测报告不存在」，与真 404 无法区分——QA 期间实际造成误诊。
describe("加载失败：404 与「没读回来」必须可区分", () => {
  function renderWithError(error: unknown) {
    vi.mocked(api.getEvalRunReport).mockRejectedValue(error);
    render(
      <MemoryRouter initialEntries={["/admin/eval/runs/run-1"]}>
        <Routes>
          <Route path="/admin/eval/runs/:runId" element={<EvalRunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("服务器答 404 → 「评测报告不存在」（这句是它说的，可以照直转述）", async () => {
    renderWithError(new api.ApiError(404, "评测 run 不存在"));
    expect(await screen.findByText("评测报告不存在")).toBeInTheDocument();
  });

  it("响应不合契约（Zod 抛错）→ 报加载失败，**绝不**说「不存在」", async () => {
    renderWithError(new Error("expected string, received undefined"));
    expect(await screen.findByText("评测报告加载失败")).toBeInTheDocument();
    expect(screen.queryByText("评测报告不存在")).not.toBeInTheDocument();
    // 原始错误要透出来，否则排查还是得靠猜
    expect(screen.getByText("expected string, received undefined")).toBeInTheDocument();
  });

  it("500 也不说「不存在」——只有 404 才是「不存在」", async () => {
    renderWithError(new api.ApiError(500, "请求失败（500）"));
    expect(await screen.findByText("评测报告加载失败")).toBeInTheDocument();
    expect(screen.queryByText("评测报告不存在")).not.toBeInTheDocument();
  });

  it("重试成功后正常渲染报告（失败不是终态）", async () => {
    vi.mocked(api.getEvalRunReport)
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce(report());
    render(
      <MemoryRouter initialEntries={["/admin/eval/runs/run-1"]}>
        <Routes>
          <Route path="/admin/eval/runs/:runId" element={<EvalRunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("评测报告加载失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    // 报告真渲染出来了（逐用例表出现），且失败态收走
    expect((await screen.findAllByTestId("cell-faithfulness"))[0]).toHaveTextContent("96");
    expect(screen.queryByText("评测报告加载失败")).not.toBeInTheDocument();
  });
});
