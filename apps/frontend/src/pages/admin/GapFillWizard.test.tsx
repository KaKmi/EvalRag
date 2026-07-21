import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GapFillDraft } from "@codecrush/contracts";
import GapFillWizard from "./GapFillWizard";

/**
 * 补知识库三步向导（原型 §17.5 `:633`，021 决策 I）。
 *
 * 这一屏的**存在理由**就是「LLM 草的内容不许直接进知识库」——所以本文件的断言重心不是
 * 渲染细节，而是那道人审闸门：没勾确认不许提交、没上线的应用不许选作回验目标、
 * 重建中的知识库不许入库。这些不是 UI 偏好，是 spec 的红线在前端这一侧的落点。
 */

const api = vi.hoisted(() => ({
  getGapFillDraft: vi.fn(),
  draftGapFill: vi.fn(),
  cancelGapFill: vi.fn(),
  submitGapFill: vi.fn(),
  getKnowledgeBases: vi.fn(),
  getApplications: vi.fn(),
  getApplicationDetail: vi.fn(),
}));
vi.mock("../../api/client", () => api);

const messageMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("antd", async () => {
  const antd = await vi.importActual<typeof import("antd")>("antd");
  return { ...antd, message: { ...antd.message, ...messageMock } };
});

const CLUSTER = "11111111-1111-4111-8111-111111111111";
const KB = "22222222-2222-4222-8222-222222222222";
const APP = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";

function draft(patch: Partial<GapFillDraft> = {}): GapFillDraft {
  return {
    clusterId: CLUSTER,
    status: "reviewing",
    representativeQuestion: "能开专用发票吗",
    draftQuestion: "能开增值税专用发票吗？",
    draftAnswer: "可以。请提供开票抬头与税号，3 个工作日内寄出。",
    targetKbId: null,
    targetDocumentId: null,
    ...patch,
  };
}

function setup(over: { kbReady?: boolean; appLive?: boolean } = {}) {
  const { kbReady = true, appLive = true } = over;
  api.getKnowledgeBases.mockResolvedValue([
    { id: KB, name: "客服知识库", status: kbReady ? "ready" : "rebuilding" },
  ]);
  api.getApplications.mockResolvedValue([{ id: APP, name: "客服机器人" }]);
  api.getApplicationDetail.mockResolvedValue({
    id: APP,
    productionConfigVersionId: appLive ? VERSION : null,
  });
}

function renderWizard() {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(
    <GapFillWizard open clusterId={CLUSTER} onClose={onClose} onChanged={onChanged} />,
  );
  return { onChanged, onClose };
}

/** 需要在同一个组件实例上开关 `open` / 换 `clusterId` 的用例走这个。 */
function renderWizardRaw(clusterId: string) {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <GapFillWizard open clusterId={clusterId} onClose={onClose} onChanged={onChanged} />,
  );
  return {
    onChanged,
    onClose,
    rerender: (open: boolean, id: string) =>
      view.rerender(
        <GapFillWizard open={open} clusterId={id} onClose={onClose} onChanged={onChanged} />,
      ),
  };
}

/** 把第②步填到「只差勾确认」的状态。 */
async function fillForm() {
  await screen.findByDisplayValue("能开增值税专用发票吗？");
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "目标知识库" }));
  fireEvent.click(await screen.findByTitle("客服知识库"));
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "回验应用" }));
  fireEvent.click(await screen.findByTitle("客服机器人"));
}

beforeEach(() => {
  vi.clearAllMocks();
  setup();
});

describe("补知识库向导", () => {
  it("状态 pending → 停在第①步，点「AI 草拟」才产生草稿", async () => {
    api.getGapFillDraft.mockResolvedValue(
      draft({ status: "pending", draftQuestion: null, draftAnswer: null }),
    );
    api.draftGapFill.mockResolvedValue({});
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /草拟/ }));

    await waitFor(() => expect(api.draftGapFill).toHaveBeenCalledWith(CLUSTER));
  });

  it("**没勾「我已核对」不许提交**——这道闸门就是本屏存在的理由", async () => {
    api.getGapFillDraft.mockResolvedValue(draft());
    renderWizard();
    await fillForm();

    // 闸门在界面侧的形态是**按钮直接禁用**，不是点了再报错。
    const submit = screen.getByRole("button", { name: "确认入库" });
    expect(submit).toBeDisabled();

    fireEvent.click(submit);

    // 断言的是「**没有**发出请求」——禁用属性写对了但 onClick 照样跑，仍然是漏。
    expect(api.submitGapFill).not.toHaveBeenCalled();
  });

  it("勾了确认 + 选齐目标 → 带 production 版本号提交", async () => {
    api.getGapFillDraft.mockResolvedValue(draft());
    api.submitGapFill.mockResolvedValue({});
    const { onClose } = renderWizard();
    await fillForm();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "确认入库" }));

    await waitFor(() =>
      expect(api.submitGapFill).toHaveBeenCalledWith(CLUSTER, {
        question: "能开增值税专用发票吗？",
        answer: "可以。请提供开票抬头与税号，3 个工作日内寄出。",
        targetKbId: KB,
        applicationId: APP,
        // 用户从没选过版本号——它是从应用的 production 指针推出来的。
        configVersionId: VERSION,
        confirmed: true,
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("提交失败**不关抽屉**，错误留在屏上（静默会诱发第二份重复文档）", async () => {
    api.getGapFillDraft.mockResolvedValue(draft());
    api.submitGapFill.mockRejectedValue(new Error("知识库正在重建，暂不可入库"));
    const { onClose } = renderWizard();
    await fillForm();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "确认入库" }));

    await screen.findByText("知识库正在重建，暂不可入库");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("未上线的应用不可选作回验目标", async () => {
    setup({ appLive: false });
    api.getGapFillDraft.mockResolvedValue(draft());
    renderWizard();
    await screen.findByDisplayValue("能开增值税专用发票吗？");

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "回验应用" }));

    // 禁用项的 label 是 Tooltip 包着的 `<span>名字 <Tag>未上线</Tag></span>`，
    // 所以 antd 不会把 `title` 设成应用名——按**文本**找，别按 title 找。
    const label = await screen.findByText("未上线");
    expect(label.closest(".ant-select-item")).toHaveClass("ant-select-item-option-disabled");
  });

  it("提交失败后**重新拉状态**（并发取消时不让用户对着同一个错反复重试）", async () => {
    api.getGapFillDraft.mockResolvedValue(draft());
    api.submitGapFill.mockRejectedValue(new Error("缺口当前状态是「pending」"));
    renderWizard();
    await fillForm();
    fireEvent.click(screen.getByRole("checkbox"));

    expect(api.getGapFillDraft).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "确认入库" }));

    // 第二次 load：失败原因可能正是「这个簇已经不在 reviewing 了」，
    // 不刷新的话界面继续显示人审表单，重试多少次都是同一个错。
    await waitFor(() => expect(api.getGapFillDraft).toHaveBeenCalledTimes(2));
  });

  /**
   * 第二轮复审抓到的 P1，且是**我修 P3 时自己引入的**：为了让并发取消能刷新状态，
   * 我在提交失败分支加了无条件 `load()`——它会把运营人工核实、改写过的答案换回
   * LLM 原始草稿，而「我已核对」复选框仍然勾着。再点一次确认入库，进知识库的
   * 就是一份没有任何人看过的 LLM 生成内容，还带着人审通过的标记。
   *
   * 这三条是那个 P1 的回归网：编辑必须活下来、确认状态必须诚实。
   */
  it("提交失败后**不覆盖**用户已改写的答案（否则人审内容被换回 LLM 草稿）", async () => {
    api.getGapFillDraft.mockResolvedValue(draft());
    api.submitGapFill.mockRejectedValue(new Error("知识库正在重建"));
    renderWizard();
    await fillForm();

    const edited = "可以。抬头+税号发我，2 个工作日内电子发票发邮箱。";
    fireEvent.change(screen.getByLabelText("补库答案"), { target: { value: edited } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "确认入库" }));

    await screen.findByText("知识库正在重建");
    // 服务端草稿仍是 LLM 那份；重新拉过之后，屏上必须还是**人写的**那份。
    expect(screen.getByLabelText("补库答案")).toHaveValue(edited);
    expect(screen.queryByDisplayValue(draft().draftAnswer!)).not.toBeInTheDocument();
  });

  it("内容被服务端草稿覆盖时，「我已核对」必须跟着作废", async () => {
    // 人只确认过他当时看见的那一份。换了内容还留着勾，等于替用户认可了他没读过的文本。
    api.getGapFillDraft.mockResolvedValue(
      draft({ status: "pending", draftQuestion: null, draftAnswer: null }),
    );
    api.draftGapFill.mockResolvedValue({});
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /草拟/ }));

    // 草拟完成 → load(preserveEdits=false) 覆盖内容，复选框必须是未勾的。
    api.getGapFillDraft.mockResolvedValue(draft());
    await screen.findByDisplayValue("能开增值税专用发票吗？");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("草拟失败要**出声**——错误不能被随后的 load 抹掉", async () => {
    // `setErr` 写在 `load()` 之前就会被 `load` 的 `setErr(null)` 吞掉，
    // 用户点完「AI 草拟」只看到界面弹回原样、没有任何原因说明。
    api.getGapFillDraft.mockResolvedValue(
      draft({ status: "pending", draftQuestion: null, draftAnswer: null }),
    );
    api.draftGapFill.mockRejectedValue(new Error("草拟模型未配置"));
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: /草拟/ }));

    expect(await screen.findByText("草拟模型未配置")).toBeInTheDocument();
  });

  it("详情请求失败的应用标「状态未知」而不是谎称「未上线」", async () => {
    setup();
    api.getApplicationDetail.mockRejectedValue(new Error("网络抖动"));
    api.getGapFillDraft.mockResolvedValue(draft());
    renderWizard();
    await screen.findByDisplayValue("能开增值税专用发票吗？");

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "回验应用" }));

    // 两者都禁用，但文案不能撒谎——用户明明在跑的应用被说成「尚未上线」会让人去查一个
    // 根本不存在的问题。
    expect(await screen.findByText("状态未知")).toBeInTheDocument();
    expect(screen.queryByText("未上线")).not.toBeInTheDocument();
  });

  it("换簇重开 → 上个簇选的回验应用不能跟着带过来", async () => {
    /**
     * 复审第二轮：`appId` 是纯本地选择，`load()` 只重置来自草稿的字段，
     * 而 `destroyOnHidden` 销毁的是 Drawer 子树、不是本组件 state。
     * 不清的话，换一个簇打开会静默沿用上一个簇选的应用——回验会跑在错误的应用上，
     * 而界面看起来完全正常。这条测的就是那个 `setAppId(undefined)`。
     */
    api.getGapFillDraft.mockResolvedValue(draft());
    const { rerender } = renderWizardRaw(CLUSTER);
    await fillForm();
    // 选中项的文字在 `.ant-select-selection-item` 上，不在 `combobox`（那是里面的 input）上。
    const appSelect = () =>
      screen.getByRole("combobox", { name: "回验应用" }).closest(".ant-select")!;
    expect(appSelect()).toHaveTextContent("客服机器人");

    // 关掉再以**另一个簇**打开——组件实例不变，state 会活下来。
    rerender(false, CLUSTER);
    const other = "55555555-5555-4555-8555-555555555555";
    api.getGapFillDraft.mockResolvedValue(draft({ clusterId: other }));
    rerender(true, other);

    await screen.findByDisplayValue("能开增值税专用发票吗？");
    expect(appSelect()).not.toHaveTextContent("客服机器人");
  });

  it("状态 filled → 第③步「入库中」，表单不再可编辑", async () => {
    api.getGapFillDraft.mockResolvedValue(draft({ status: "filled" }));
    renderWizard();

    // ⚠️ 不能断言 /入库中/：那是 Steps 的第③步标题，**每个状态都渲染**，
    // 拿它当判据的话连 `verified`（走的是「补库向导不适用」兜底 Alert）都能通过——
    // 复审用一个探针测试实测证明了这一点。要断言只属于 filled 面板的文本。
    await screen.findByText("已提交入库");
    // 人审表单必须已经收起：还留着就意味着能对一份已入库的内容再改一遍。
    expect(screen.queryByLabelText("补库答案")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认入库" })).not.toBeInTheDocument();
  });

  it("取消补库 → 保留草稿并关闭", async () => {
    api.getGapFillDraft.mockResolvedValue(draft());
    api.cancelGapFill.mockResolvedValue({});
    const { onClose, onChanged } = renderWizard();
    await screen.findByDisplayValue("能开增值税专用发票吗？");

    fireEvent.click(screen.getByRole("button", { name: /取消补库/ }));

    await waitFor(() => expect(api.cancelGapFill).toHaveBeenCalledWith(CLUSTER));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
