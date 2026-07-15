import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { SessionDetailResponse } from "@codecrush/contracts";
import SessionDetailPage from "./SessionDetailPage";
import * as client from "../../api/client";

vi.mock("../../api/client", () => ({ getSession: vi.fn() }));
const mocked = vi.mocked(client);

const detail: SessionDetailResponse = {
  sessionId: "conv1",
  userId: "u1",
  agentId: "app1",
  agentName: "退款助手",
  rounds: [
    {
      traceId: "a".repeat(32),
      userInput: "怎么退款",
      output: "支持 7 天无理由[1]",
      status: "success",
      durationMs: 2410,
      startTime: "2026-07-13T09:11:00.000Z",
    },
    {
      traceId: "b".repeat(32),
      userInput: "多久到账",
      output: "很抱歉，暂时无法回答。",
      status: "fallback",
      durationMs: 1500,
      startTime: "2026-07-13T09:12:00.000Z",
    },
  ],
};

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/admin/traces/sessions/${id}`]}>
      <Routes>
        <Route path="/admin/traces/sessions/:sessionId" element={<SessionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SessionDetailPage (M9 W3)", () => {
  it("renders chat bubbles + per-bot trace anchor from session detail", async () => {
    mocked.getSession.mockResolvedValue(detail);
    renderAt("conv1");
    // 用户问 + bot 答气泡
    expect((await screen.findAllByText("怎么退款")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("支持 7 天无理由[1]")).toBeInTheDocument();
    // 头部轮次
    expect(screen.getAllByText(/2 轮/).length).toBeGreaterThanOrEqual(1);
    // 溯源条：traceId + 链路入口（每 bot 泡一条）
    expect(screen.getByText("a".repeat(32))).toBeInTheDocument();
    expect(screen.getAllByText(/链路 →/).length).toBe(2);
    // 兜底轮状态标
    expect(screen.getAllByText("兜底").length).toBeGreaterThanOrEqual(1);
  });

  it("empty session shows not-found placeholder", async () => {
    mocked.getSession.mockResolvedValue({
      sessionId: "x",
      userId: null,
      agentId: "",
      agentName: "",
      rounds: [],
    });
    renderAt("x");
    expect(await screen.findByText(/未找到该会话/)).toBeInTheDocument();
  });
});
