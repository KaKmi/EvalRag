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
  movePromptTag: vi.fn(),
  removePromptTag: vi.fn(),
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

describe("Prompt 详情 · 标签面板（012 Story 6）", () => {
  it("展示全部标签及指向版本，编辑版本以外的标签提供「移到 vX」", async () => {
    renderRoutes("/admin/prompts/p1");
    const panel = await screen.findByTestId("tag-panel");
    expect(panel).toHaveTextContent("production → v2");
    expect(panel).toHaveTextContent("只是记账标记，移动/摘除不影响任何服务");
    // production 已指向当前编辑版本 v2 → 无移动按钮，只有摘除
    expect(screen.queryByText("移到 v2")).not.toBeInTheDocument();
  });

  it("自定义标签入口校验：非法字符 / production / v（大小写不敏感）被拒", async () => {
    renderRoutes("/admin/prompts/p1");
    await screen.findByTestId("tag-panel");
    const input = screen.getByPlaceholderText("自定义标识（字母/数字/._-）");
    const submit = screen.getByText("标到当前版本");

    fireEvent.change(input, { target: { value: "有 空格" } });
    fireEvent.click(submit);
    expect(await screen.findByText("仅允许字母、数字、.、_、-")).toBeInTheDocument();
    expect(mocked.movePromptTag).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "PRODUCTION" } });
    fireEvent.click(submit);
    expect(await screen.findByText(/production 请通过/)).toBeInTheDocument();
    expect(mocked.movePromptTag).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "V" } });
    fireEvent.click(submit);
    expect(await screen.findByText(/v 是保留字/)).toBeInTheDocument();
    expect(mocked.movePromptTag).not.toHaveBeenCalled();
  });

  it("合法自定义标签归一小写后移动到当前编辑版本", async () => {
    mocked.movePromptTag.mockResolvedValue([
      { name: "beta.1", versionId: "pv2", version: 2 },
      { name: "production", versionId: "pv2", version: 2 },
    ]);
    renderRoutes("/admin/prompts/p1");
    await screen.findByTestId("tag-panel");
    fireEvent.change(screen.getByPlaceholderText("自定义标识（字母/数字/._-）"), {
      target: { value: "Beta.1" },
    });
    fireEvent.click(screen.getByText("标到当前版本"));
    await waitFor(() =>
      expect(mocked.movePromptTag).toHaveBeenCalledWith("p1", {
        name: "beta.1",
        versionId: "pv2",
      }),
    );
    // 成功后 refetch 详情
    await waitFor(() => expect(mocked.getPromptDetail.mock.calls.length).toBeGreaterThan(1));
  });

  it("移动标签需二次确认，文案明确不影响任何服务", async () => {
    mocked.movePromptTag.mockResolvedValue([]);
    renderRoutes("/admin/prompts/p1");
    // 载入 v1（历史抽屉），production 指向 v2 → 出现「移到 v1」
    fireEvent.click(await screen.findByText("🕑 历史版本 2"));
    fireEvent.click(await screen.findByTestId("history-version-1"));
    fireEvent.click(await screen.findByText("移到 v1"));
    expect(await screen.findByText("仅移动 Prompt 标签，不影响任何服务。")).toBeInTheDocument();
    // antd 两字中文按钮自动插空格（移 动）
    fireEvent.click(screen.getByRole("button", { name: /移\s?动/ }));
    await waitFor(() =>
      expect(mocked.movePromptTag).toHaveBeenCalledWith("p1", {
        name: "production",
        versionId: "pv1",
      }),
    );
  });

  it("摘除标签需二次确认；失败时提示并 refetch 以服务端为准", async () => {
    mocked.removePromptTag.mockRejectedValue(new Error("conflict"));
    renderRoutes("/admin/prompts/p1");
    await screen.findByTestId("tag-panel");
    const before = mocked.getPromptDetail.mock.calls.length;
    fireEvent.click(screen.getByLabelText("摘除 production"));
    expect(await screen.findByText("仅摘除 Prompt 标签，不影响任何服务。")).toBeInTheDocument();
    // 触发按钮 aria-label 也含「摘除」，用精确匹配 Popconfirm 的确认按钮
    fireEvent.click(screen.getByRole("button", { name: "摘 除" }));
    await waitFor(() => expect(mocked.removePromptTag).toHaveBeenCalledWith("p1", "production"));
    await waitFor(() =>
      expect(mocked.getPromptDetail.mock.calls.length).toBeGreaterThan(before),
    );
  });
});
