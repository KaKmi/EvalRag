import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TraceDetailResponse } from "@codecrush/contracts";
import TraceDetailPage from "./TraceDetailPage";
import * as client from "../../api/client";

vi.mock("../../api/client", () => ({
  getTrace: vi.fn(),
  getTraceQuality: vi.fn(),
  // B1/F2：「加入评测集」按钮两态的数据源；弹窗内部还会用到集列表与创建接口。
  getEvalCaseRefs: vi.fn(),
  getEvalSets: vi.fn(),
  createEvalCase: vi.fn(),
  createEvalSet: vi.fn(),
}));
const mocked = vi.mocked(client);

const detail: TraceDetailResponse = {
  traceId: "a".repeat(32),
  meta: {
    userInput: "怎么退款",
    agentId: "app-1",
    agentName: "退款助手",
    genModel: "deepseek-v3",
    genModelVersion: null,
    promptVersionId: "cv1",
    durationMs: 2410,
    inputTokens: 1200,
    outputTokens: 200,
    cost: null,
    status: "failed",
    qualitySignals: [],
  },
  spans: [
    {
      traceId: "a".repeat(32),
      spanId: "root".padEnd(16, "0"),
      parentSpanId: null,
      name: "rag.pipeline",
      kind: "chain",
      startTime: "2026-07-13T09:11:00.000Z",
      durationMs: 2410,
      statusCode: "Ok",
      statusMessage: null,
      attributes: {
        "codecrush.io.input": "怎么退款",
        "rag.citation.ids": JSON.stringify([{ n: 1, doc: "退款政策 V3.2", score: 0.94 }]),
      },
    },
    {
      traceId: "a".repeat(32),
      spanId: "ret".padEnd(16, "0"),
      parentSpanId: "root".padEnd(16, "0"),
      name: "retrieval.retrieve",
      kind: "retrieval",
      startTime: "2026-07-13T09:11:00.100Z",
      durationMs: 300,
      statusCode: "Error",
      statusMessage: "上游超时",
      attributes: {
        "rag.chunk.scores": JSON.stringify([
          {
            chunkId: "c1",
            doc: "退款政策 V3.2 · 第二条",
            vec: 0.9,
            kw: 0.1,
            rerank: 0.94,
            final: 0.9,
          },
        ]),
      },
    },
  ],
};

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/admin/traces/${id}`]}>
      <Routes>
        <Route path="/admin/traces/:traceId" element={<TraceDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getTrace.mockResolvedValue(detail);
  mocked.getTraceQuality.mockResolvedValue({ status: "unscored" });
  mocked.getEvalCaseRefs.mockResolvedValue([]);
  mocked.getEvalSets.mockResolvedValue([]);
});

describe("TraceDetailPage (M9 W2)", () => {
  it("uses a wider responsive call-chain column", async () => {
    renderAt("a".repeat(32));
    expect(await screen.findByTestId("trace-call-chain")).toHaveStyle({
      width: "34vw",
      minWidth: "560px",
      maxWidth: "680px",
    });
  });
  it("renders head meta from real detail", async () => {
    renderAt("a".repeat(32));
    expect(await screen.findByText("退款助手")).toBeInTheDocument(); // Agent cell（唯一）
    expect(screen.getByText("deepseek-v3")).toBeInTheDocument();
    expect(screen.getAllByText("怎么退款").length).toBeGreaterThan(0); // 用户问题 + TRACE 根行
  });

  it("failed trace auto-selects the error span and shows error message", async () => {
    renderAt("a".repeat(32));
    // 错误信息出现在顶部置顶告警条 + 选中节点错误框（#4 降级/异常置顶）
    expect((await screen.findAllByText(/上游超时/)).length).toBeGreaterThan(0);
  });

  it("retrieval span shows hit-scores table with doc name", async () => {
    renderAt("a".repeat(32));
    expect(await screen.findByText(/退款政策 V3.2 · 第二条/)).toBeInTheDocument();
  });

  // E-W2b F7：头部新增「↻ 重放」按钮（原「无重放，M11」注记已随本波交付）。
  it("has a replay button (agentId present)", async () => {
    renderAt("a".repeat(32));
    await screen.findByText("退款助手");
    expect(screen.getByRole("button", { name: "↻ 重放" })).toBeEnabled();
  });

  it("keeps trace content when quality loading fails", async () => {
    mocked.getTraceQuality.mockRejectedValueOnce(new Error("quality unavailable"));
    renderAt("a".repeat(32));
    expect((await screen.findAllByText("怎么退款")).length).toBeGreaterThan(0);
    expect(await screen.findByText("质量数据暂不可用")).toBeInTheDocument();
  });

  it("renders unscored as read-only without score or retry actions", async () => {
    renderAt("a".repeat(32));
    expect(await screen.findByText("未抽样评测")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /立即评测|重试/ })).not.toBeInTheDocument();
  });

  it("renders partial scored quality with neutral unscored faithfulness", async () => {
    mocked.getTraceQuality.mockResolvedValueOnce({
      status: "scored",
      scores: { faithfulness: null, answerRelevancy: 80, contextPrecision: 70 },
      thresholds: { faithfulness: 85, answerRelevancy: 80, contextPrecision: 80 },
      judgeModel: "judge-1",
      judgeVersion: "online-v2",
      scoredAt: "2026-07-15T02:00:00.000Z",
      currentVersion: true,
      evidence: {
        answerRelevancy: ["relevant"],
        contextPrecision: ["one noisy chunk"],
      },
    });
    renderAt("a".repeat(32));

    expect(await screen.findByText("未评")).toBeInTheDocument();
    expect(screen.getByTestId("quality-score-faithfulness")).toHaveAttribute(
      "data-quality-state",
      "unscored",
    );
  });

  it("keeps complete scored quality pass and low states", async () => {
    mocked.getTraceQuality.mockResolvedValueOnce({
      status: "scored",
      scores: { faithfulness: 90, answerRelevancy: 80, contextPrecision: 70 },
      thresholds: { faithfulness: 85, answerRelevancy: 80, contextPrecision: 80 },
      judgeModel: "judge-1",
      judgeVersion: "online-v2",
      scoredAt: "2026-07-15T02:00:00.000Z",
      currentVersion: true,
      evidence: {
        faithfulness: ["grounded"],
        answerRelevancy: ["relevant"],
        contextPrecision: ["one noisy chunk"],
      },
    });
    renderAt("a".repeat(32));

    await screen.findByText("90");
    expect(screen.getByTestId("quality-score-faithfulness")).toHaveAttribute(
      "data-quality-state",
      "pass",
    );
    expect(screen.getByTestId("quality-score-contextPrecision")).toHaveAttribute(
      "data-quality-state",
      "low",
    );
  });
});

// —— B1/F2：「加入评测集」按钮两态（原型 §17.6 `:647`）——

it("未入集 → 显示「+ 加入评测集」，点击开弹窗", async () => {
  mocked.getEvalCaseRefs.mockResolvedValue([]);
  renderAt("a".repeat(32));
  const btn = await screen.findByRole("button", { name: "+ 加入评测集" });
  fireEvent.click(btn);
  expect(await screen.findByText("加入评测集")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("留空则进集后为待补 gold")).toBeInTheDocument();
});

it("已入集 → 按钮变「已在评测集 · 查看」，不再显示加入按钮", async () => {
  mocked.getEvalCaseRefs.mockResolvedValue([
    { setId: "s1", setName: "售后核心 50 题", caseId: "c1" },
  ]);
  renderAt("a".repeat(32));
  expect(await screen.findByRole("button", { name: "已在评测集 · 查看" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "+ 加入评测集" })).not.toBeInTheDocument();
});

/** 读 case-refs 失败不能把按钮弄没——退回「未入集」态，用户仍可尝试入集（后端会真实校验）。 */
it("case-refs 读取失败 → 退回「+ 加入评测集」态", async () => {
  mocked.getEvalCaseRefs.mockRejectedValue(new Error("boom"));
  renderAt("a".repeat(32));
  expect(await screen.findByRole("button", { name: "+ 加入评测集" })).toBeInTheDocument();
});
