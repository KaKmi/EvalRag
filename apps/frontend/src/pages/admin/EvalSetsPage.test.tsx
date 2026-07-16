import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { EvalCase, EvalSet } from "@codecrush/contracts";
import * as api from "../../api/client";
import EvalSetsPage from "./EvalSetsPage";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getEvalSets: vi.fn(),
    getEvalCases: vi.fn(),
    createEvalSet: vi.fn(),
    deleteEvalSet: vi.fn(),
    createEvalCase: vi.fn(),
    updateEvalCase: vi.fn(),
    deleteEvalCase: vi.fn(),
    importEvalCases: vi.fn(),
    createEvalRun: vi.fn(),
    getKnowledgeBases: vi.fn(),
    getDocuments: vi.fn(),
    getApplications: vi.fn(),
    getApplicationDetail: vi.fn(),
    getOnlineEvalSettings: vi.fn(),
  };
});
vi.mock("antd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("antd")>();
  return { ...actual, message: { error: vi.fn(), success: vi.fn() } };
});

const evalSet = (over: Partial<EvalSet> = {}): EvalSet => ({
  id: "set-1",
  name: "售后核心 50 题",
  description: "",
  kbIds: ["kb-1"],
  caseCount: 50,
  reviewedCaseCount: 50,
  goldDocCoverage: { withGoldDocs: 38, total: 50 },
  lastRunScore: 82,
  hasCompletedRun: true,
  createdAt: "2026-07-10T02:00:00.000Z",
  updatedAt: "2026-07-14T02:00:00.000Z",
  ...over,
});

const evalCase = (over: Partial<EvalCase> = {}): EvalCase => ({
  id: "case-1",
  setId: "set-1",
  version: 1,
  status: "reviewed",
  question: "课程可以退款吗",
  goldPoints: ["7 天内无理由退", "已开课按比例"],
  goldDocIds: [],
  tags: ["退款"],
  sourceTraceId: null,
  goldStale: false,
  createdAt: "2026-07-10T02:00:00.000Z",
  ...over,
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderPage(sets: EvalSet[] = [evalSet()]) {
  vi.mocked(api.getEvalSets).mockResolvedValue(sets);
  return render(
    <MemoryRouter initialEntries={["/admin/eval/sets"]}>
      <EvalSetsPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** CSV：表头 + n 行数据。 */
function csvWithNRows(n: number): string {
  const rows = Array.from({ length: n }, (_, i) => `问题${i + 1},要点A；要点B`);
  return ["question,gold_answer", ...rows].join("\n");
}

/** Modal 渲染在 body 的 portal 里，不在 render 的 container 内 → 从 document 找 Upload 的 input。 */
async function uploadCsv(content: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([content], "cases.csv", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getKnowledgeBases).mockResolvedValue([]);
  vi.mocked(api.getDocuments).mockResolvedValue([]);
  vi.mocked(api.getEvalCases).mockResolvedValue([evalCase()]);
  vi.mocked(api.getApplications).mockResolvedValue([]);
  vi.mocked(api.getOnlineEvalSettings).mockResolvedValue({
    settings: {
      id: "default",
      enabled: true,
      sampleRate: 0.1,
      judgeModelId: "judge-1",
      embeddingModelId: "embed-1",
      faithfulnessThreshold: 80,
      answerRelevancyThreshold: 80,
      contextPrecisionThreshold: 80,
      dailyCap: 500,
      judgeVersion: "online-v1",
      updatedAt: "2026-07-15T02:00:00.000Z",
    },
    models: {
      judges: [{ id: "judge-1", name: "qwen-plus", enabled: true, available: true }],
      embeddings: [{ id: "embed-1", name: "bge-m3", enabled: true, available: true }],
    },
  });
});

it("0 条已审核用例 →「发起评测」禁用并提示", async () => {
  renderPage([evalSet({ name: "空集", reviewedCaseCount: 0, caseCount: 3 })]);
  const btn = await screen.findByRole("button", { name: "发起评测" });
  expect(btn).toBeDisabled();
  // React 的 onMouseEnter 由 mouseover 合成 → fireEvent 必须发 mouseOver；
  // 且 antd 给 disabled 子元素包一层 span 承接 hover。
  fireEvent.mouseOver(btn.parentElement!);
  expect(await screen.findByText("至少 1 条已审核用例")).toBeInTheDocument();
});

it("删除评测集走 Popconfirm，文案照抄原型 §19.2", async () => {
  renderPage();
  // antd 给「两个汉字」按钮插空格（「删 除」）→ 一律用宽松匹配
  fireEvent.click(await screen.findByRole("button", { name: /删\s*除/ }));
  expect(
    await screen.findByText("删除后列表不再显示；历史报告仍可查看。确认删除？"),
  ).toBeInTheDocument();
  vi.mocked(api.deleteEvalSet).mockResolvedValue();
  // [0] = 行内「删除」，[1] = Popconfirm 的确认按钮（portal 挂在 body 末尾）
  const buttons = screen.getAllByRole("button", { name: /删\s*除/ });
  fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() => expect(api.deleteEvalSet).toHaveBeenCalledWith("set-1"));
});

it("列表按原型 §5 显示 gold docs 覆盖率与一位小数的上次得分", async () => {
  renderPage([evalSet(), evalSet({ id: "set-2", name: "高频 Badcase 集", kbIds: [], caseCount: 34, reviewedCaseCount: 0, goldDocCoverage: { withGoldDocs: 0, total: 34 }, lastRunScore: null, hasCompletedRun: false })]);
  expect(await screen.findByText("38/50")).toBeInTheDocument();
  expect(screen.getByText("82.0")).toBeInTheDocument();
  // 未跑过的集：null 得分显示「未运行」，绝不是 0；未关联知识库显示「全部」
  expect(screen.getByText("未运行")).toBeInTheDocument();
  expect(screen.getByText("0/34")).toBeInTheDocument();
  expect(screen.getByText("全部")).toBeInTheDocument();
});

// QA P2：一个跑完 5 次 run 的集合被显示成「未运行」——NULL 是对的，词是假的。
it("跑过但没出分的集 →「未出分」而非「未运行」（两种 null 成因必须分词）", async () => {
  renderPage([
    evalSet({ id: "set-3", name: "全超时的集", lastRunScore: null, hasCompletedRun: true }),
  ]);
  expect(await screen.findByText("未出分")).toBeInTheDocument();
  // 「跑过」的集合绝不能被说成没跑过
  expect(screen.queryByText("未运行")).not.toBeInTheDocument();
  // 且仍然绝不退化成 0（本波中心不变式）
  expect(screen.queryByText("0")).not.toBeInTheDocument();
  expect(screen.queryByText("0.0")).not.toBeInTheDocument();
});

it("CSV 导入：>1000 行前端即拒，文案「超过 1000 行，请拆分」", async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "导入 CSV" }));
  await uploadCsv(csvWithNRows(1001));
  expect(await screen.findByText("超过 1000 行，请拆分")).toBeInTheDocument();
  expect(api.importEvalCases).not.toHaveBeenCalled();
});

it("CSV 导入：合法行照发，后端逐行回执标红并可下载", async () => {
  renderPage();
  vi.mocked(api.importEvalCases).mockResolvedValue({
    imported: 1,
    errors: [{ row: 2, message: "第 2 行缺少 gold_answer" }],
  });
  fireEvent.click(await screen.findByRole("button", { name: "导入 CSV" }));
  const modal = await screen.findByRole("dialog");
  // 目标评测集必选（集名同时出现在主表与下拉里 → 用 option 角色消歧）
  // antd Select 不是原生 <select>：mouseDown 开下拉后点选项内容（集名同时出现在主表里 →
  // 必须限定在下拉门户内取，否则 getByText 命中多个）。
  fireEvent.mouseDown(within(modal).getByRole("combobox"));
  await screen.findByRole("option", { name: "售后核心 50 题" });
  const dropdown = document.querySelector(".ant-select-dropdown") as HTMLElement;
  fireEvent.click(within(dropdown).getByText("售后核心 50 题"));
  await uploadCsv("question,gold_answer\n课程可以退款吗,7 天内无理由退\n缺答案的问题,");
  expect(await screen.findByText("已解析 2 行")).toBeInTheDocument();
  fireEvent.click(within(modal).getByRole("button", { name: "开始导入" }));
  // 缺 gold_answer 的行**照发**（该行拒由后端判定并回执），不在前端整批拦掉
  await waitFor(() =>
    expect(api.importEvalCases).toHaveBeenCalledWith("set-1", {
      rows: [
        { question: "课程可以退款吗", goldAnswer: "7 天内无理由退" },
        { question: "缺答案的问题", goldAnswer: "" },
      ],
    }),
  );
  expect(await screen.findByText("第 2 行缺少 gold_answer")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下载回执" })).toBeInTheDocument();
});

it("新建评测集：空名称报「请输入名称」，不发请求", async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: /新建评测集/ }));
  fireEvent.click(await screen.findByRole("button", { name: /创\s*建/ }));
  expect(await screen.findByText("请输入名称")).toBeInTheDocument();
  expect(api.createEvalSet).not.toHaveBeenCalled();
});

it("新建评测集：重名透出后端「名称已存在」", async () => {
  renderPage();
  vi.mocked(api.createEvalSet).mockRejectedValue(new Error("名称已存在"));
  fireEvent.click(await screen.findByRole("button", { name: /新建评测集/ }));
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "售后核心 50 题" } });
  fireEvent.click(screen.getByRole("button", { name: /创\s*建/ }));
  expect(await screen.findByText("名称已存在")).toBeInTheDocument();
});

it("展开行显示用例子表，行点击开编辑抽屉", async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: /Expand row/i }));
  expect(await screen.findByText("课程可以退款吗")).toBeInTheDocument();
  await waitFor(() => expect(api.getEvalCases).toHaveBeenCalledWith("set-1"));
  fireEvent.click(screen.getByText("课程可以退款吗"));
  // gold 要点按分号回填（原型 §5「按要点分号分隔」）
  expect(await screen.findByDisplayValue("7 天内无理由退；已开课按比例")).toBeInTheDocument();
  expect(screen.getByText("保存将生成新版本，历史报告仍引用旧版本")).toBeInTheDocument();
});

it("已审核用例清空 gold 要点报「至少填写 1 个答案要点」", async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: /Expand row/i }));
  fireEvent.click(await screen.findByText("课程可以退款吗"));
  fireEvent.change(await screen.findByLabelText("gold 答案"), { target: { value: "  " } });
  fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
  expect(await screen.findByText("至少填写 1 个答案要点")).toBeInTheDocument();
  expect(api.updateEvalCase).not.toHaveBeenCalled();
});

it("发起评测 409 幂等 → 弹「1 小时内已有相同评测结果」，「仍重新运行」带 force 重发", async () => {
  renderPage();
  vi.mocked(api.getApplications).mockResolvedValue([
    { id: "app-1", name: "售后支持", productionConfigVersionId: "ver-7" } as never,
  ]);
  vi.mocked(api.getApplicationDetail).mockResolvedValue({
    id: "app-1",
    productionConfigVersionId: "ver-7",
    versions: [{ id: "ver-7", version: 7 }],
  } as never);
  vi.mocked(api.createEvalRun)
    .mockRejectedValueOnce(new api.RecentEvalRunConflictError("run-old"))
    .mockResolvedValueOnce({ id: "run-new" } as never);

  fireEvent.click(await screen.findByRole("button", { name: "发起评测" }));
  await screen.findByText("发起评测 · 售后核心 50 题");
  await waitFor(() => expect(screen.getByTestId("version-select")).toHaveTextContent("v7"));
  fireEvent.click(screen.getByRole("button", { name: "开始运行" }));

  // antd 6 的 Modal.confirm 把 title 同时渲染进 .ant-modal-title 与 .ant-modal-confirm-title
  expect(await screen.findAllByText("1 小时内已有相同评测结果")).not.toHaveLength(0);
  expect(screen.getByRole("button", { name: /查\s*看/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "仍重新运行" }));
  await waitFor(() =>
    expect(api.createEvalRun).toHaveBeenLastCalledWith(expect.objectContaining({ force: true })),
  );
  // 成功后跳 run 详情页（原型 §6：Modal 关闭后跳 run 详情页）
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent("/admin/eval/runs/run-new"),
  );
});

// QA P3-1：预估耗时曾是硬编码的「3~6 分钟」，而原型那句是**对 50 条说的**。
describe("发起评测 Modal 的预估耗时随用例数缩放", () => {
  async function openRunModal(reviewedCaseCount: number) {
    renderPage([evalSet({ reviewedCaseCount })]);
    vi.mocked(api.getApplications).mockResolvedValue([
      { id: "app-1", name: "售后支持", productionConfigVersionId: "ver-7" } as never,
    ]);
    vi.mocked(api.getApplicationDetail).mockResolvedValue({
      id: "app-1",
      productionConfigVersionId: "ver-7",
      versions: [{ id: "ver-7", version: 7 }],
    } as never);
    fireEvent.click(await screen.findByRole("button", { name: "发起评测" }));
    return await screen.findByText(/预估：/);
  }

  it("50 条 → 逐字复现原型 §6 的「3~6 分钟」（锚点不漂移）", async () => {
    expect(await openRunModal(50)).toHaveTextContent("耗时 3~6 分钟");
  });

  it("5 条 → 按比例缩到「0.3~0.6 分钟」，不再谎报 3~6 分钟", async () => {
    const line = await openRunModal(5);
    expect(line).toHaveTextContent("耗时 0.3~0.6 分钟");
    expect(line).not.toHaveTextContent("3~6 分钟");
  });

  it("200 条 → 放大到「12~24 分钟」", async () => {
    expect(await openRunModal(200)).toHaveTextContent("耗时 12~24 分钟");
  });
});
