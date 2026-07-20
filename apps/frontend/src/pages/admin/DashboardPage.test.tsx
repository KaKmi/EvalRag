import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { MetricsOverviewResponse } from "@codecrush/contracts";
import * as client from "../../api/client";
import DashboardPage from "./DashboardPage";

vi.mock("../../api/client", () => ({
  getApplications: vi.fn(),
  getMetricsOverview: vi.fn(),
  getApplicationMetrics: vi.fn(),
  // B2a Task 10：答案质量摘要行。**漏加这一个**会让该导出为 undefined，
  // 本文件既有用例会在渲染时全炸——工厂是穷举的，不是 partial mock。
  getQualityOverview: vi.fn(),
}));

const mocked = vi.mocked(client);
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}
const metrics: MetricsOverviewResponse = {
  window: {
    qaCount: 1284,
    failCount: 64,
    failRate: 0.05,
    fallbackCount: 103,
    fallbackRate: 0.08,
    lowRecallCount: 4,
    noCiteCount: 3,
    refusalCount: 2,
    timeoutCount: 1,
    p50Ms: 2100,
    p95Ms: 4800,
    inputTokens: 12000,
    outputTokens: 3000,
    costUsd: 0,
  },
  series: [
    {
      bucket: "2026-07-13T00:00:00.000Z",
      qaCount: 500,
      failCount: 10,
      fallbackCount: 20,
      p50Ms: 2000,
      p95Ms: 4000,
      inputTokens: 5000,
      outputTokens: 1000,
      costUsd: 0,
    },
    {
      bucket: "2026-07-14T00:00:00.000Z",
      qaCount: 784,
      failCount: 54,
      fallbackCount: 83,
      p50Ms: 2200,
      p95Ms: 4800,
      inputTokens: 7000,
      outputTokens: 2000,
      costUsd: 0,
    },
  ],
};
const appMetrics = {
  ...metrics,
  stages: [
    { stage: "rewrite" as const, sampleCount: 10, p50Ms: 120, p95Ms: 240 },
    { stage: "intent" as const, sampleCount: 10, p50Ms: 100, p95Ms: 200 },
    { stage: "embedding" as const, sampleCount: 8, p50Ms: 30, p95Ms: 60 },
    { stage: "retrieval" as const, sampleCount: 8, p50Ms: 300, p95Ms: 700 },
    { stage: "rerank" as const, sampleCount: 0, p50Ms: null, p95Ms: null },
    { stage: "generation" as const, sampleCount: 10, p50Ms: 900, p95Ms: 1800 },
  ],
  signals: {
    ttft: { sampleCount: 10, p50Ms: 220, p95Ms: 480 },
    generationRate: { sampleCount: 10, p50TokensPerSecond: 24, p95TokensPerSecond: 40 },
    repair: { attemptCount: 2, eligibleCount: 20, rate: 0.1 },
    degradation: {
      keyword: { count: 1, eligibleCount: 8, rate: 0.125 },
      rerank: { count: 1, eligibleCount: 5, rate: 0.2 },
    },
    confidence: {
      sampleCount: 8,
      p50: 0.75,
      buckets: [
        { key: "very_low" as const, count: 1 },
        { key: "low" as const, count: 2 },
        { key: "medium" as const, count: 3 },
        { key: "high" as const, count: 2 },
      ],
    },
    citations: {
      sampleCount: 10,
      averageCount: 1.8,
      countBuckets: [
        { key: "none" as const, count: 2 },
        { key: "one" as const, count: 3 },
        { key: "two_three" as const, count: 4 },
        { key: "four_plus" as const, count: 1 },
      ],
      coverage: { full: 6, partial: 3, unknown: 1 },
    },
  },
};

/** 屏1 的 overview 响应（只造摘要行用得到的字段）。 */
function qualityOverview(over: {
  enabled?: boolean;
  evaluatedCount?: number;
  sampleCount?: number;
  previousDelta?: number | null;
} = {}) {
  const sampleCount = over.sampleCount ?? 120;
  const metric = (value: number, low: boolean) => ({
    value,
    threshold: 85,
    low,
    sampleCount,
    previousDelta: over.previousDelta === undefined ? 3 : over.previousDelta,
  });
  return {
    meta: {
      enabled: over.enabled ?? true,
      evaluatedCount: over.evaluatedCount ?? 120,
      judgeVersion: "online-v1",
      lagHours: 0,
      backlog: 0,
      budgetReduced: false,
    },
    metrics: {
      faithfulness: metric(91, false),
      answerRelevancy: metric(88, false),
      contextPrecision: metric(70, true),
    },
    trend: [],
    perApp: [],
  };
}

beforeEach(() => {
  mocked.getApplications.mockResolvedValue([]);
  mocked.getMetricsOverview.mockResolvedValue(metrics);
  mocked.getApplicationMetrics.mockResolvedValue(appMetrics);
  mocked.getQualityOverview.mockResolvedValue(qualityOverview() as never);
});

it("loads real metrics and does not present reserved zero cost as actual spend", async () => {
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText("1,284")).toBeInTheDocument();
  expect(screen.getByText("8.0%")).toHaveStyle({ color: "#ff4d4f" });
  expect(screen.getByText("真实计价尚未启用")).toBeInTheDocument();
  expect(screen.getByLabelText("问答量趋势图")).toBeInTheDocument();
  expect(mocked.getMetricsOverview).toHaveBeenCalled();
});

it("uses the application metrics endpoint after selecting an application", async () => {
  mocked.getApplications.mockResolvedValueOnce([{ id: "app-1", name: "退款助手" } as never]);
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
  await screen.findByText("1,284");
  fireEvent.mouseDown(screen.getByLabelText("应用筛选"));
  fireEvent.click(await screen.findByText("退款助手"));
  await waitFor(() =>
    expect(mocked.getApplicationMetrics).toHaveBeenCalledWith("app-1", expect.any(Object)),
  );
  expect(await screen.findByText("退款助手 · 分阶段耗时")).toBeInTheDocument();
  expect(screen.getByText("检索总段")).toBeInTheDocument();
  expect(screen.getByText("重排")).toBeInTheDocument();
  expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  expect(screen.getByText("首字延迟 P95")).toBeInTheDocument();
  expect(screen.getByText("480ms")).toBeInTheDocument();
  expect(screen.getByText("生成速度 P50")).toBeInTheDocument();
  expect(screen.getByText("24.0 token/s")).toBeInTheDocument();
});

it("renders a visible API error instead of stale mock data", async () => {
  mocked.getMetricsOverview.mockRejectedValueOnce(new Error("ClickHouse unavailable"));
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText("运行指标加载失败")).toBeInTheDocument();
  expect(screen.getByText("ClickHouse unavailable")).toBeInTheDocument();
});

it("drills repair metrics into the exact signal/model trace filter", async () => {
  mocked.getApplications.mockResolvedValueOnce([{ id: "app-1", name: "Repair App" } as never]);
  render(
    <MemoryRouter initialEntries={["/admin/dashboard"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <DashboardPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText("1,284");
  fireEvent.mouseDown(screen.getByLabelText("应用筛选"));
  fireEvent.click(await screen.findByText("Repair App"));
  fireEvent.change(screen.getByLabelText("模型筛选"), { target: { value: "deepseek-chat" } });
  const repair = await screen.findByText("结构化修复率");
  fireEvent.click(repair.closest('[role="button"]')!);
  expect(screen.getByTestId("location").textContent).toContain("/admin/traces?");
  expect(screen.getByTestId("location").textContent).toContain("signal=repair");
  expect(screen.getByTestId("location").textContent).toContain("agentId=app-1");
  expect(screen.getByTestId("location").textContent).toContain("model=deepseek-chat");
});


// ───────────────── B2a Task 10：答案质量摘要行（原型 §17.1 / :226 / :761） ─────────────────

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <DashboardPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

it("渲染「答案质量」摘要行，并可跳屏1", async () => {
  renderDashboard();
  expect(await screen.findByText("答案质量")).toBeInTheDocument();
  expect(await screen.findByTestId("dash-metric-faithfulness")).toBeInTheDocument();

  fireEvent.click(screen.getByText("查看详情 →"));
  expect(screen.getByTestId("location").textContent).toContain("/admin/quality");
});

it("样本不足（n<20）时显示「样本不足」且不显 Δ（原型 :226）", async () => {
  mocked.getQualityOverview.mockResolvedValue(qualityOverview({ sampleCount: 5 }) as never);
  renderDashboard();
  await screen.findByTestId("dash-metric-faithfulness");

  expect(screen.getAllByText("样本不足").length).toBeGreaterThan(0);
  // Δ 是「▲/▼ N」形态；小样本下一个都不该出现（避免小样本误读）。
  expect(screen.queryByText(/[▲▼]\s*\d/)).not.toBeInTheDocument();
});

it("在线评测未开启时给原型 :761 的空态，而不是一排 0", async () => {
  mocked.getQualityOverview.mockResolvedValue(
    qualityOverview({ enabled: false, evaluatedCount: 0 }) as never,
  );
  renderDashboard();
  await screen.findByText("答案质量");

  expect(await screen.findByText(/在线评测未开启/)).toBeInTheDocument();
  expect(screen.queryByTestId("dash-metric-faithfulness")).not.toBeInTheDocument();
});

it("质量行失败不拖垮整页（其余看板照常渲染）", async () => {
  mocked.getQualityOverview.mockRejectedValue(new Error("boom"));
  renderDashboard();

  expect(await screen.findByText("问答量与异常趋势")).toBeInTheDocument();
  expect(await screen.findByText("1,284")).toBeInTheDocument();
});
