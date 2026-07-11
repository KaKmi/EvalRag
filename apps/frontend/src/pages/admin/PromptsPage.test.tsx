import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Prompt, PromptDetail, PromptVersion } from "@codecrush/contracts";
import PromptsPage from "./PromptsPage";
import PromptDetailPage from "./PromptDetailPage";
import * as client from "../../api/client";

// 012 Story 5：列表导航 / 新建跳转 / 详情编辑保存 / 历史载入与副本 / 无发布回滚 UI
vi.mock("../../api/client", () => ({
  getPrompts: vi.fn(),
  getPromptDetail: vi.fn(),
  createPrompt: vi.fn(),
  createPromptVersion: vi.fn(),
  deletePrompt: vi.fn(),
}));

const mocked = vi.mocked(client);

function makeVersion(over: Partial<PromptVersion> = {}): PromptVersion {
  return {
    id: "pv1",
    promptId: "p1",
    version: 1,
    body: "",
    variables: [],
    author: "demo@codecrush.local",
    contractVersion: 1,
    compileStatus: "ok",
    compileErrors: [],
    tags: [],
    createdAt: "2026-07-10T08:00:00.000Z",
    ...over,
  };
}

function makePrompt(over: Partial<Prompt> = {}): Prompt {
  return {
    id: "p1",
    name: "售后回复生成",
    node: "reply",
    latestVersion: 2,
    versionCount: 2,
    tags: ["production"],
    variables: ["query"],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-10T08:00:00.000Z",
    updatedBy: "demo@codecrush.local",
    ...over,
  };
}

function makeDetail(over: Partial<PromptDetail> = {}): PromptDetail {
  return {
    ...makePrompt(),
    versions: [
      makeVersion({ id: "pv2", version: 2, body: "依据 {retrievalContext} 回答 {query}", tags: ["production"], note: "加引用要求" }),
      makeVersion({ id: "pv1", version: 1, body: "回答 {query}" }),
    ],
    ...over,
  };
}

function renderRoutes(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/admin/prompts" element={<PromptsPage />} />
        <Route path="/admin/prompts/:promptId" element={<PromptDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getPrompts.mockResolvedValue({
    items: [makePrompt()],
    total: 1,
    page: 1,
    pageSize: 10,
  });
  mocked.getPromptDetail.mockResolvedValue(makeDetail());
});

describe("Prompt 列表页（012）", () => {
  it("展示最新版本 / 标识 / 变量列，无发布状态列与发布按钮", async () => {
    renderRoutes("/admin/prompts");
    expect(await screen.findByText("售后回复生成")).toBeInTheDocument();
    expect(screen.getByText("最新版本")).toBeInTheDocument();
    expect(screen.getByText("标识")).toBeInTheDocument();
    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByText("{query}")).toBeInTheDocument();
    // 012：发布状态机 UI 不存在
    expect(screen.queryByText("状态")).not.toBeInTheDocument();
    expect(screen.queryByText("发布")).not.toBeInTheDocument();
    expect(screen.queryByText("回滚")).not.toBeInTheDocument();
    expect(screen.queryByText("生产中")).not.toBeInTheDocument();
  });

  it("点行导航到 /admin/prompts/:id 详情", async () => {
    renderRoutes("/admin/prompts");
    fireEvent.click(await screen.findByText("售后回复生成"));
    await waitFor(() => expect(mocked.getPromptDetail).toHaveBeenCalledWith("p1"));
    expect(await screen.findByText("你希望它怎么做")).toBeInTheDocument();
  });

  it("新建弹窗只填名称/节点，成功后跳详情", async () => {
    mocked.createPrompt.mockResolvedValue(makeDetail({ id: "p9", name: "新建的" }));
    mocked.getPromptDetail.mockResolvedValue(makeDetail({ id: "p9", name: "新建的" }));
    renderRoutes("/admin/prompts");
    fireEvent.click(await screen.findByText("＋ 新建 Prompt"));
    expect(await screen.findByText("新建 Prompt")).toBeInTheDocument();
    // 弹窗内没有正文输入（012：v1 空 body 服务端生成）
    expect(screen.queryByPlaceholderText("在此编写 Prompt 模板…")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("如：售后回复生成"), {
      target: { value: "新建的" },
    });
    fireEvent.click(screen.getByText("创建并打开"));
    await waitFor(() =>
      expect(mocked.createPrompt).toHaveBeenCalledWith({ name: "新建的", node: "reply" }),
    );
    // 跳详情
    expect(await screen.findByText("你希望它怎么做")).toBeInTheDocument();
    expect(mocked.getPromptDetail).toHaveBeenCalledWith("p9");
  });
});

describe("Prompt 详情 Playground（012）", () => {
  it("直接路由进入：载入最新版本正文，头部含节点与历史版本计数", async () => {
    renderRoutes("/admin/prompts/p1");
    expect(await screen.findByText("你希望它怎么做")).toBeInTheDocument();
    expect(screen.getByText("回复生成")).toBeInTheDocument();
    expect(screen.getByText("🕑 历史版本 2")).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText("用大白话写清楚这一节点该怎么做…");
    expect(textarea).toHaveValue("依据 {retrievalContext} 回答 {query}");
    // 编辑中版本标注
    expect(screen.getByText(/编辑中 v2/)).toBeInTheDocument();
    // 无发布/回滚 UI
    expect(screen.queryByText(/发布/)).not.toBeInTheDocument();
    expect(screen.queryByText(/回滚/)).not.toBeInTheDocument();
  });

  it("本地实时编译：未知字段标红并支持一键修复", async () => {
    renderRoutes("/admin/prompts/p1");
    const textarea = await screen.findByPlaceholderText("用大白话写清楚这一节点该怎么做…");
    fireEvent.change(textarea, { target: { value: "回答 {qeury}" } });
    expect(await screen.findByText(/未知字段 \{qeury\}/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("一键改为 {query}"));
    expect(textarea).toHaveValue("回答 {query}");
    await waitFor(() =>
      expect(screen.queryByText(/未知字段/)).not.toBeInTheDocument(),
    );
  });

  it("保存总是创建新版本（携带 sourceVersionId），成功后切到新版本", async () => {
    mocked.createPromptVersion.mockResolvedValue(
      makeVersion({ id: "pv3", version: 3, body: "新的正文 {query}" }),
    );
    mocked.getPromptDetail
      .mockResolvedValueOnce(makeDetail())
      .mockResolvedValueOnce(
        makeDetail({
          latestVersion: 3,
          versionCount: 3,
          versions: [
            makeVersion({ id: "pv3", version: 3, body: "新的正文 {query}" }),
            ...makeDetail().versions,
          ],
        }),
      );
    renderRoutes("/admin/prompts/p1");
    const textarea = await screen.findByPlaceholderText("用大白话写清楚这一节点该怎么做…");
    fireEvent.change(textarea, { target: { value: "新的正文 {query}" } });
    fireEvent.change(
      screen.getByPlaceholderText("版本说明（可选）：记录本次修改，便于回溯"),
      { target: { value: "第三版" } },
    );
    fireEvent.click(screen.getByText("保存为新版本"));
    await waitFor(() =>
      expect(mocked.createPromptVersion).toHaveBeenCalledWith("p1", {
        body: "新的正文 {query}",
        note: "第三版",
        sourceVersionId: "pv2",
      }),
    );
    expect(await screen.findByText(/编辑中 v3/)).toBeInTheDocument();
  });

  it("历史抽屉：点行载入版本；「创建副本」预填『基于 vX 修改』", async () => {
    renderRoutes("/admin/prompts/p1");
    fireEvent.click(await screen.findByText("🕑 历史版本 2"));
    expect(await screen.findByTestId("history-version-1")).toBeInTheDocument();
    // 点行载入 v1
    fireEvent.click(screen.getByTestId("history-version-1"));
    const textarea = screen.getByPlaceholderText("用大白话写清楚这一节点该怎么做…");
    expect(textarea).toHaveValue("回答 {query}");
    expect(screen.getByText(/编辑中 v1/)).toBeInTheDocument();
    // 创建副本：预填版本说明
    fireEvent.click(screen.getByText("🕑 历史版本 2"));
    const copyButtons = await screen.findAllByText("创建副本");
    fireEvent.click(copyButtons[0]); // v2 的副本
    expect(
      screen.getByPlaceholderText("版本说明（可选）：记录本次修改，便于回溯"),
    ).toHaveValue("基于 v2 修改");
  });

  it("试运行区在能力接入前不展示可运行状态", async () => {
    renderRoutes("/admin/prompts/p1");
    expect(await screen.findByTestId("try-run-panel")).toBeInTheDocument();
    expect(screen.getByText("试运行能力接入中（保存的版本可随时回来试）")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^运行/ })).not.toBeInTheDocument();
  });
});
