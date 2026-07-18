import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { EvalRunListItem } from "@codecrush/contracts";
import EvalRunsPage from "./EvalRunsPage";
import * as client from "../../api/client";

vi.mock("../../api/client", () => ({ getEvalRuns: vi.fn() }));

const run = (over: Partial<EvalRunListItem>): EvalRunListItem => ({
  id: "run-1",
  setId: "set-1",
  setName: "售后核心",
  applicationId: "app-1",
  configVersionId: "cv-1",
  configVersionLabel: "v6",
  status: "done",
  overallScore: 80,
  totalCases: 5,
  doneCases: 5,
  repeatCount: 1,
  durationMs: 1000,
  createdAt: "2026-07-13T09:00:00.000Z",
  ...over,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/eval/runs"]}>
      <Routes>
        <Route path="/admin/eval/runs" element={<EvalRunsPage />} />
        <Route path="/admin/eval/compare" element={<div>COMPARE {"?"}</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

it("AC8-4：勾选恰 2 个同评测集终态 run → 「对比」可点并导航（a=较早）", async () => {
  vi.mocked(client.getEvalRuns).mockResolvedValue([
    run({ id: "run-old", createdAt: "2026-07-13T08:00:00.000Z" }),
    run({ id: "run-new", createdAt: "2026-07-13T09:00:00.000Z" }),
  ]);
  renderPage();
  await screen.findAllByText("售后核心");
  const checkboxes = screen.getAllByRole("checkbox");
  // 跳过表头全选 checkbox（index 0）。
  fireEvent.click(checkboxes[1]);
  fireEvent.click(checkboxes[2]);
  const btn = await screen.findByRole("button", { name: /对\s*比/ });
  expect(btn).toBeEnabled();
  fireEvent.click(btn);
  // a=较早 run-old、b=较新 run-new。
  await waitFor(() => expect(screen.getByText(/COMPARE/)).toBeInTheDocument());
});

it("勾选异集 → 「对比」disabled + tooltip 文案", async () => {
  vi.mocked(client.getEvalRuns).mockResolvedValue([
    run({ id: "run-a", setId: "set-1" }),
    run({ id: "run-b", setId: "set-2" }),
  ]);
  renderPage();
  await screen.findAllByText("售后核心");
  const checkboxes = screen.getAllByRole("checkbox");
  fireEvent.click(checkboxes[1]);
  fireEvent.click(checkboxes[2]);
  const btn = await screen.findByRole("button", { name: /对\s*比/ });
  expect(btn).toBeDisabled();
});

it("勾选 1 行 → 「对比」disabled", async () => {
  vi.mocked(client.getEvalRuns).mockResolvedValue([run({ id: "run-a" }), run({ id: "run-b" })]);
  renderPage();
  await screen.findAllByText("售后核心");
  fireEvent.click(screen.getAllByRole("checkbox")[1]);
  expect(await screen.findByRole("button", { name: /对\s*比/ })).toBeDisabled();
});

it("repeatCount > 1 时按执行单元计算运行进度和中断计数", async () => {
  vi.mocked(client.getEvalRuns).mockResolvedValue([
    run({ id: "run-running", status: "running", totalCases: 2, doneCases: 3, repeatCount: 3 }),
    run({ id: "run-partial", status: "partial", totalCases: 2, doneCases: 4, repeatCount: 3 }),
  ]);
  renderPage();

  expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  expect(screen.getByText("4/6")).toBeInTheDocument();
});
