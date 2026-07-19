import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalSet, GapItem } from "@codecrush/contracts";
import BadSampleToEvalSetModal from "./BadSampleToEvalSetModal";

/**
 * 「从坏样本生成」三步 Modal（原型 `:255` / §17.2 `:596` / `:634`）。
 *
 * 断言逐字对着原型与决策 G：默认全选、指代未消解的行被守卫挡住、草拟失败仍可入集、
 * 成功 toast「已加入 N 条，状态待审核」。
 */

const api = vi.hoisted(() => ({
  getGaps: vi.fn(),
  getGapItems: vi.fn(),
  getEvalSets: vi.fn(),
  createEvalSet: vi.fn(),
  draftGapGold: vi.fn(),
  promoteGapToEvalSet: vi.fn(),
}));
vi.mock("../../api/client", () => api);

const messageMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("antd", async () => {
  const antd = await vi.importActual<typeof import("antd")>("antd");
  return { ...antd, message: { ...antd.message, ...messageMock } };
});

const CLUSTER = "11111111-1111-4111-8111-111111111111";
const SET = "33333333-3333-4333-8333-333333333333";

function item(patch: Partial<GapItem> = {}): GapItem {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    clusterId: CLUSTER,
    source: "online",
    sourceTraceId: "a".repeat(32),
    question: "能开专用发票吗",
    rewrittenQuestion: null,
    rewriteResolved: true,
    followUpSuspected: false,
    traceStartTime: null,
    traceExpired: false,
    faithfulness: null,
    answerRelevancy: null,
    contextPrecision: null,
    confidence: null,
    ...patch,
  };
}

const evalSet: EvalSet = {
  id: SET,
  name: "售后核心 50 题",
  description: "",
  kbIds: [],
  caseCount: 50,
  reviewedCaseCount: 50,
  goldDocCaseCount: 38,
  lastScore: 82,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
} as unknown as EvalSet;

const unresolved = item({
  id: "44444444-4444-4444-8444-444444444444",
  question: "还有上面说的某某点需要注意什么",
  rewrittenQuestion: null,
  rewriteResolved: false,
});
const resolved = item({
  id: "55555555-5555-4555-8555-555555555555",
  question: "还有上面说的某某点需要注意什么",
  rewrittenQuestion: "管理中的授权要点需要注意什么",
  rewriteResolved: true,
});

function open(items: GapItem[] = [item()], onDone = vi.fn()) {
  api.getGapItems.mockResolvedValue(items);
  render(
    <BadSampleToEvalSetModal
      open
      presetClusterId={CLUSTER}
      onClose={vi.fn()}
      onDone={onDone}
    />,
  );
  return onDone;
}

/** 走到第②步（第①步已因 presetClusterId 锁定并预选）。 */
async function toStep2(items: GapItem[] = [item()], onDone = vi.fn()) {
  const done = open(items, onDone);
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  await screen.findByText(/gold 要点/);
  return done;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getGaps.mockResolvedValue({ items: [], total: 0 });
  api.getEvalSets.mockResolvedValue([evalSet]);
  api.draftGapGold.mockResolvedValue({ goldPoints: ["要点一", "要点二", "要点三"] });
  api.promoteGapToEvalSet.mockResolvedValue({ created: 1, caseIds: ["c1"] });
});

describe("BadSampleToEvalSetModal", () => {
  it("locks step 1 to the preselected cluster when opened from 屏5 (原型 :634)", async () => {
    open();
    expect(await screen.findByText("已锁定为你选中的缺口簇")).toBeInTheDocument();
    // 锁定时不需要、也不该去拉整张缺口列表。
    expect(api.getGaps).not.toHaveBeenCalled();
  });

  it("walks the three steps 来源 → 勾选问题 → 目标集 (原型 :596)", async () => {
    await toStep2();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByText("目标评测集")).toBeInTheDocument();
  });

  it("renders the gold guidance Alert (缺口 26)", async () => {
    await toStep2();
    expect(screen.getByText(/一个好答案必须包含什么/)).toBeInTheDocument();
    expect(screen.getByText(/不是「资料里说过什么」/)).toBeInTheDocument();
  });

  it("selects all selectable questions by default (原型 :255)", async () => {
    await toStep2([resolved, item()]);
    const checked = screen
      .getAllByRole("checkbox")
      .filter((box) => (box as HTMLInputElement).checked && !(box as HTMLInputElement).disabled);
    // 两条数据行 + 表头全选框
    expect(checked).toHaveLength(3);
  });

  it("shows the rewritten question as the one that will be saved", async () => {
    await toStep2([resolved]);
    expect(screen.getByDisplayValue("管理中的授权要点需要注意什么")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("还有上面说的某某点需要注意什么")).not.toBeInTheDocument();
  });

  it("flags an unresolved-rewrite row and blocks it from being selected (决策 G)", async () => {
    await toStep2([unresolved]);
    expect(screen.getByText("指代未消解")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("改写成可独立检索的问题")).toBeInTheDocument();
    const rowBox = screen
      .getAllByRole("checkbox")
      .find((box) => (box as HTMLInputElement).name?.startsWith("unresolved-"))!;
    expect(rowBox).toBeDisabled();
    // 默认全选**不含**被守卫挡住的行。
    expect((rowBox as HTMLInputElement).checked).toBe(false);
  });

  it("unblocks the row once the user rewrites it into a standalone question", async () => {
    await toStep2([unresolved]);
    fireEvent.change(screen.getByPlaceholderText("改写成可独立检索的问题"), {
      target: { value: "管理中的授权要点需要注意什么" },
    });
    await waitFor(() => {
      const rowBox = screen
        .getAllByRole("checkbox")
        .find((box) => (box as HTMLInputElement).name?.startsWith("unresolved-"))!;
      expect(rowBox).toBeEnabled();
    });
  });

  it("marks a failed draft 草拟失败 yet keeps it selectable (原型 :596)", async () => {
    api.draftGapGold.mockRejectedValue(new Error("判官挂了"));
    await toStep2();
    expect(await screen.findByText("草拟失败")).toBeInTheDocument();
    const rowBox = screen.getAllByRole("checkbox")[1] as HTMLInputElement;
    expect(rowBox.disabled).toBe(false);
    expect(rowBox.checked).toBe(true);
  });

  it("submits the edited question and drafted gold, then toasts 已加入 N 条，状态待审核", async () => {
    api.promoteGapToEvalSet.mockResolvedValue({ created: 2, caseIds: ["c1", "c2"] });
    const onDone = await toStep2([resolved]);
    await screen.findByText("草稿");

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    const select = await screen.findByText("目标评测集");
    fireEvent.mouseDown(within(select.parentElement!).getByRole("combobox"));
    fireEvent.click(await screen.findByTitle("售后核心 50 题"));
    fireEvent.click(screen.getByRole("button", { name: "确认生成" }));

    await waitFor(() =>
      expect(api.promoteGapToEvalSet).toHaveBeenCalledWith({
        clusterId: CLUSTER,
        targetSetId: SET,
        items: [
          {
            itemId: resolved.id,
            question: "管理中的授权要点需要注意什么",
            goldPoints: ["要点一", "要点二", "要点三"],
          },
        ],
      }),
    );
    expect(messageMock.success).toHaveBeenCalledWith("已加入 2 条，状态待审核");
    // 跳目标集靠这个回调（调用方决定是展开还是导航）。
    expect(onDone).toHaveBeenCalledWith(SET);
  });

  it("never sends chunk text to the draft endpoint — only the question (9.8)", async () => {
    await toStep2([resolved]);
    await waitFor(() => expect(api.draftGapGold).toHaveBeenCalled());
    expect(api.draftGapGold).toHaveBeenCalledWith({ question: "管理中的授权要点需要注意什么" });
  });

  it("surfaces a promote failure instead of pretending it worked", async () => {
    api.promoteGapToEvalSet.mockRejectedValue(new Error("指代未消解，不能直接入集"));
    await toStep2([resolved]);
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    const select = await screen.findByText("目标评测集");
    fireEvent.mouseDown(within(select.parentElement!).getByRole("combobox"));
    fireEvent.click(await screen.findByTitle("售后核心 50 题"));
    fireEvent.click(screen.getByRole("button", { name: "确认生成" }));

    expect(await screen.findByText("指代未消解，不能直接入集")).toBeInTheDocument();
    expect(messageMock.success).not.toHaveBeenCalled();
  });

  /**
   * peer review 抓出：未消解的行进第②步时 question 是空的（刻意不预填指代原文），
   * 会被 `draftAll` 跳过而停在 idle；若 idle 态只渲染静态文字，那批**最需要帮助的行**
   * 人工改写后也永远拿不到 gold 草稿。
   */
  it("人工改写未消解行之后，能触发该行的 gold 草拟", async () => {
    api.draftGapGold.mockResolvedValue({ goldPoints: ["要点一", "要点二", "要点三"] });
    await toStep2([unresolved]);

    // 改写前：空问题 ⇒ 没有草拟入口。
    expect(screen.queryByRole("button", { name: "草拟 gold" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("改写成可独立检索的问题"), {
      target: { value: "管理中的授权要点需要注意什么" },
    });

    const draftBtn = await screen.findByRole("button", { name: "草拟 gold" });
    fireEvent.click(draftBtn);

    await waitFor(() =>
      expect(api.draftGapGold).toHaveBeenCalledWith({
        question: "管理中的授权要点需要注意什么",
      }),
    );
  });
});