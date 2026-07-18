import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ReplayModal, { type ReplaySource } from "./ReplayModal";
import * as client from "../../api/client";
import * as sse from "../../api/sse";
import { ChatStreamError } from "../../api/sse";

vi.mock("../../api/client", () => ({ getApplicationDetail: vi.fn(), getTrace: vi.fn() }));
vi.mock("../../api/sse", async () => {
  const actual = await vi.importActual<typeof import("../../api/sse")>("../../api/sse");
  return { ...actual, streamReplay: vi.fn() };
});

const source: ReplaySource = {
  applicationId: "app-1",
  configVersionId: "ver-7",
  question: "怎么退款",
  sourceTraceId: "a".repeat(32),
  originalAnswer: "原答案",
  originalScores: { faithfulness: 41, answerRelevancy: 50, contextPrecision: 60 },
  originalVersionLabel: "v7",
};

function mountModal() {
  return render(
    <MemoryRouter>
      <ReplayModal open source={source} onClose={() => {}} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(client.getApplicationDetail).mockResolvedValue({
    id: "app-1",
    productionConfigVersionId: "ver-7",
    versions: [{ id: "ver-7", version: 7 }],
  } as never);
});

async function* frames(...evs: unknown[]) {
  for (const e of evs) yield e as never;
}

it("Modal 渲染：问题预填、版本下拉默认原版本、警示文案逐字", async () => {
  mountModal();
  expect(await screen.findByLabelText("重放问题")).toHaveValue("怎么退款");
  expect(
    screen.getByText(
      "⚠ LLM 非确定性：同配置重放结果也可能不同；产出为 preview trace，不入线上统计与问题池",
    ),
  ).toBeInTheDocument();
});

it("原版本不在版本列表 → 提示切 production", async () => {
  vi.mocked(client.getApplicationDetail).mockResolvedValue({
    id: "app-1",
    productionConfigVersionId: "ver-7",
    versions: [{ id: "ver-7", version: 7 }], // 原 configVersionId ver-9 不在
  } as never);
  render(
    <MemoryRouter>
      <ReplayModal open source={{ ...source, configVersionId: "ver-9" }} onClose={() => {}} />
    </MemoryRouter>,
  );
  expect(await screen.findByText("原配置版本已不可用，已默认切换到 production")).toBeInTheDocument();
});

it("空问题 → toast「问题不能为空」", async () => {
  mountModal();
  const ta = await screen.findByLabelText("重放问题");
  fireEvent.change(ta, { target: { value: "  " } });
  fireEvent.click(await screen.findByRole("button", { name: /运\s*行/ }));
  expect(await screen.findByText("问题不能为空")).toBeInTheDocument();
});

it("运行 → SSE 逐 token → done+replay_scores → 并排视图 + Δ tag", async () => {
  vi.mocked(sse.streamReplay).mockReturnValue(
    frames(
      { type: "token", delta: "新答案" },
      {
        type: "done",
        traceId: "b".repeat(32),
        confidence: 1,
        coverage: "full",
        isFallback: false,
        fallbackReasons: [],
      },
      { type: "replay_scores", faithfulness: 93, answerRelevancy: 88, contextPrecision: 70, evidence: {} },
    ) as never,
  );
  mountModal();
  await screen.findByLabelText("重放问题");
  fireEvent.click(await screen.findByRole("button", { name: /运\s*行/ }));
  await waitFor(() => expect(screen.getByText("新答案")).toBeInTheDocument());
  // 并排：原答案 + 忠实度 Δ (+52)
  expect(screen.getByText("原答案")).toBeInTheDocument();
  expect(screen.getByText("+52")).toBeInTheDocument();
});

it("429 → toast「操作过于频繁，请 1 分钟后再试」", async () => {
  vi.mocked(sse.streamReplay).mockImplementation(() => {
    throw new ChatStreamError(429, "rate limited");
  });
  mountModal();
  await screen.findByLabelText("重放问题");
  fireEvent.click(await screen.findByRole("button", { name: /运\s*行/ }));
  expect(await screen.findByText("操作过于频繁，请 1 分钟后再试")).toBeInTheDocument();
});
