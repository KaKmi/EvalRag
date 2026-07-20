import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Divider,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { EvalSet, GapCluster, GapItem } from "@codecrush/contracts";
import {
  createEvalSet,
  draftGapGold,
  getEvalSets,
  getGapItems,
  getGaps,
  promoteGapToEvalSet,
} from "../../api/client";

const { Text } = Typography;

/**
 * 「从坏样本生成」三步 Modal（原型 `:255` 交互说明 + §17.2 `:596` 组件矩阵）。
 *
 * 三步逐字对原型：①选来源（问题池簇）→ ②勾选问题（默认全选，LLM 预填 gold 草稿）
 * → ③选目标评测集（新建或并入）。生成的用例状态 =「待审核」，审核通过前不参与评测运行。
 *
 * 从屏5 的 `[进评测集]` 打开时第①步**锁定**为该簇（原型 `:634`：「预选本簇问题」）。
 *
 * 本波刻意不做的：原型第①步还写了「trace 筛选条件」这条来源。它需要一套 trace 查询 UI
 * 与一条把 trace 批量转成候选问题的后端路径，两者都不在 B2a 范围内——**不渲染**，
 * 而不是渲染一个选了没反应的 Radio。
 */

/** §19.1 的上限。本地先拦：`postJson` 会在发请求前同步抛 ZodError（message 是一坨 JSON）。 */
const QUESTION_MAX = 500;
const GOLD_POINT_MAX = 200;
/** 契约 `PromoteGapRequestSchema` 的批次上限。 */
const BATCH_MAX = 50;
/** 逐条草拟的并发上限——N 行同时打判官模型会把它打爆，也会让行内 Spin 全部卡住。 */
const DRAFT_CONCURRENCY = 3;

/** D7 / 缺口 26：与后端草拟 prompt **同源**的一句话。人和模型被同一条口径约束。 */
const GOLD_GUIDANCE =
  "gold 要点 = 「一个好答案必须包含什么」，不是「资料里说过什么」：写判定答案是否合格的必要条件，别复述资料原文。";

/** 决策 G：为什么指代原文不能直接入集。同一句话在 Tooltip 与后端 400 文案里出现。 */
const UNRESOLVED_REASON = "离线评测无对话上下文，指代原文永远答不对，会成为永久 0 分用例";

interface DraftRow {
  item: GapItem;
  /** 可编辑的最终问题。预填 `rewrittenQuestion ?? question`（决策 G）。 */
  question: string;
  goldPoints: string[];
  draft: "idle" | "loading" | "ok" | "failed";
}

/**
 * 决策 G 的入集守卫：问题为空的行不可勾选。
 *
 * 对 `rewriteResolved === false` 的行这就是「必须先人工改写」——它们的问题框初始就是**空的**
 * （不预填指代原文：预填了人会直接勾上，等于把守卫做成了摆设）。
 * 已消解的行预填了改写后问题，天然满足，除非人自己把它清空。
 */
function isSelectable(row: DraftRow): boolean {
  return row.question.trim().length > 0;
}

export interface BadSampleToEvalSetModalProps {
  open: boolean;
  /** 从屏5 `[进评测集]` 打开时传入：第①步锁定为该簇，不可改。 */
  presetClusterId?: string;
  /**
   * 锁定态下用于显示的**代表问题**。必须由调用方传——锁定态刻意不去拉 `getGaps`
   * （没必要为了一个标签拉一整页簇），于是本地 `clusters` 恒空，
   * 回退到 `clusterId` 会让第①步的下拉里显示一串**裸 UUID**，
   * 而确认「我选对了哪个簇」正是这一步存在的唯一意义。
   */
  presetClusterLabel?: string;
  onClose: () => void;
  /** 成功后回调（目标集 id），供调用方刷新列表 / 展开该集。 */
  onDone?: (setId: string) => void;
}

export default function BadSampleToEvalSetModal({
  open,
  presetClusterId,
  presetClusterLabel,
  onClose,
  onDone,
}: BadSampleToEvalSetModalProps) {
  const [step, setStep] = useState(0);
  const [clusters, setClusters] = useState<GapCluster[]>([]);
  const [clusterId, setClusterId] = useState<string | undefined>(presetClusterId);
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  /** 簇成员超过单批上限时被截掉的条数——**必须显式告诉用户**，见下方 Alert。 */
  const [truncated, setTruncated] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [sets, setSets] = useState<EvalSet[]>([]);
  const [setId, setSetId] = useState<string | undefined>();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 每次打开都从头来：留着上一簇的勾选与 gold 草稿会让人把 A 簇的要点填进 B 簇。
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setClusterId(presetClusterId);
    setRows(null);
    setSelected([]);
    setSetId(undefined);
    setNewName("");
    setErr(null);
  }, [open, presetClusterId]);

  // 锁定簇时不必拉列表（第①步只显示这一个）。
  useEffect(() => {
    if (!open || presetClusterId) return;
    void getGaps({ limit: 200 })
      .then((res) => setClusters(res.items))
      .catch(() => setClusters([]));
  }, [open, presetClusterId]);

  useEffect(() => {
    if (!open) return;
    void getEvalSets()
      .then(setSets)
      .catch(() => setSets([]));
  }, [open]);

  /**
   * 逐条草拟，最多 3 条并发。失败只标「草拟失败」——**该行仍可入集**（原型 `:596`：
   * gold 留空，进集后是 draft，人补齐）。一条草拟失败就整批不让走，代价远大于收益。
   */
  const draftAll = async (initial: DraftRow[]) => {
    const targets = initial.filter((row) => row.question.trim());
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const row = targets[cursor++];
        const id = row.item.id;
        setRows((prev) =>
          prev?.map((r) => (r.item.id === id ? { ...r, draft: "loading" } : r)) ?? prev,
        );
        try {
          const { goldPoints } = await draftGapGold({ question: row.question.trim() });
          setRows(
            (prev) =>
              prev?.map((r) => (r.item.id === id ? { ...r, goldPoints, draft: "ok" } : r)) ?? prev,
          );
        } catch {
          setRows(
            (prev) => prev?.map((r) => (r.item.id === id ? { ...r, draft: "failed" } : r)) ?? prev,
          );
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(DRAFT_CONCURRENCY, targets.length) }, () => worker()),
    );
  };

  /**
   * 进第②步：拉簇内问题 → 默认全选（原型 `:255`）**只选可选行** → 逐条草拟 gold。
   * 默认全选把被守卫禁用的行也算进去的话，用户点「下一步」才会撞上 400，
   * 而那时他已经以为自己确认过一遍了。
   */
  const enterStep2 = useCallback(async () => {
    if (!clusterId) {
      setErr("请先选择来源缺口");
      return;
    }
    setErr(null);
    setStep(1);
    setRows(null);
    let loaded: GapItem[];
    try {
      loaded = await getGapItems(clusterId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载簇内问题失败");
      setRows([]);
      return;
    }
    // 静默截断是最坏的一种：一个 freq=80 的高频簇只列出 50 条、界面上毫无痕迹，
    // 用户会以为「这个簇就这么多」，剩下的永远进不了集——而高频簇恰恰最该沉淀。
    setTruncated(Math.max(0, loaded.length - BATCH_MAX));
    const initial: DraftRow[] = loaded.slice(0, BATCH_MAX).map((item) => ({
      item,
      question: (item.rewriteResolved ? (item.rewrittenQuestion ?? item.question) : "").trim(),
      goldPoints: [],
      draft: "idle",
    }));
    setRows(initial);
    setSelected(initial.filter(isSelectable).map((row) => row.item.id));
    void draftAll(initial);
  }, [clusterId]);

  const patchRow = (id: string, patch: Partial<DraftRow>) =>
    setRows((prev) => prev?.map((r) => (r.item.id === id ? { ...r, ...patch } : r)) ?? prev);

  /** 单行重试草拟（草拟失败后的出口，原型 §18.C `:702`「草拟失败,可重试」）。 */
  const retryDraft = async (row: DraftRow) => {
    const question = row.question.trim();
    if (!question) return;
    patchRow(row.item.id, { draft: "loading" });
    try {
      const { goldPoints } = await draftGapGold({ question });
      patchRow(row.item.id, { goldPoints, draft: "ok" });
    } catch {
      patchRow(row.item.id, { draft: "failed" });
    }
  };

  const createSet = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const created = await createEvalSet({ name, kbIds: [] });
      setSets((prev) => [...prev, created]);
      setSetId(created.id);
      setNewName("");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "新建评测集失败");
    } finally {
      setCreating(false);
    }
  };

  const submit = async () => {
    if (!clusterId) return setErr("请先选择来源缺口");
    if (!setId) return setErr("请选择目标评测集");
    const chosen = (rows ?? []).filter((row) => selected.includes(row.item.id));
    if (chosen.length === 0) return setErr("请至少勾选 1 个问题");

    // 本地先拦契约的硬约束：不挡的话 postJson 会在发请求前同步抛 ZodError，
    // 用户在 toast 里看到一段序列化的 issues 数组，而弹窗里没有任何提示指向出错的那一行。
    const tooLong = chosen.find((row) => row.question.trim().length > QUESTION_MAX);
    if (tooLong) return setErr(`问题不超过 ${QUESTION_MAX} 字：「${tooLong.question.slice(0, 20)}…」`);
    const badGold = chosen.find((row) => row.goldPoints.some((p) => p.length > GOLD_POINT_MAX));
    if (badGold) return setErr(`gold 要点每条不超过 ${GOLD_POINT_MAX} 字`);

    setErr(null);
    setSubmitting(true);
    try {
      const { created } = await promoteGapToEvalSet({
        clusterId,
        targetSetId: setId,
        items: chosen.map((row) => ({
          itemId: row.item.id,
          question: row.question.trim(),
          goldPoints: row.goldPoints,
        })),
      });
      message.success(`已加入 ${created} 条，状态待审核`);
      onDone?.(setId);
      onClose();
    } catch (e) {
      // 失败必须出声：静默会让人以为已经加进去了，转头再点一次造重复用例。
      setErr(e instanceof Error ? e.message : "加入评测集失败");
    } finally {
      setSubmitting(false);
    }
  };

  const clusterLabel =
    clusters.find((c) => c.id === clusterId)?.representativeQuestion ??
    presetClusterLabel ??
    // 兜底文案而不是裸 UUID：一串 id 对用户没有任何确认价值。
    (clusterId ? "本缺口簇" : "");

  return (
    <Modal
      open={open}
      title="从坏样本生成"
      width={820}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          {step > 0 && <Button onClick={() => setStep(step - 1)}>上一步</Button>}
          {step === 0 && (
            <Button type="primary" disabled={!clusterId} onClick={() => void enterStep2()}>
              下一步
            </Button>
          )}
          {step === 1 && (
            <Button type="primary" disabled={selected.length === 0} onClick={() => setStep(2)}>
              下一步
            </Button>
          )}
          {step === 2 && (
            <Button type="primary" loading={submitting} onClick={() => void submit()}>
              确认生成
            </Button>
          )}
        </Space>
      }
    >
      <Steps
        size="small"
        current={step}
        style={{ marginBottom: 16 }}
        items={[{ title: "来源" }, { title: "勾选问题" }, { title: "目标集" }]}
      />

      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}

      {step === 0 && (
        <div>
          <div style={{ fontSize: 12, marginBottom: 6 }}>来源缺口</div>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: "100%" }}
            placeholder="选择一个问题池缺口簇"
            // 从屏5 打开时**锁定**：来源已经由那个按钮决定了，这里再给一个下拉只会制造歧义。
            disabled={Boolean(presetClusterId)}
            value={clusterId}
            onChange={(v) => {
              setClusterId(v);
              setErr(null);
            }}
            options={
              presetClusterId
                ? [{ value: presetClusterId, label: clusterLabel || "本缺口簇" }]
                : clusters.map((c) => ({
                    value: c.id,
                    label: `${c.representativeQuestion}（×${c.freq}）`,
                  }))
            }
          />
          {presetClusterId && (
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 6 }}>
              已锁定为你选中的缺口簇
            </Text>
          )}
        </div>
      )}

      {step === 1 && (
        <div>
          <Alert type="info" showIcon message={GOLD_GUIDANCE} style={{ marginBottom: 12 }} />
          {truncated > 0 && (
            <Alert
              type="warning"
              showIcon
              message={`该缺口还有 ${truncated} 条未显示：单次最多加入 ${BATCH_MAX} 条，本次列出前 ${BATCH_MAX} 条。`}
              style={{ marginBottom: 12 }}
            />
          )}
          {rows === null ? (
            <Spin />
          ) : rows.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该缺口暂无成员" />
          ) : (
            <Table<DraftRow>
              rowKey={(row) => row.item.id}
              size="small"
              pagination={false}
              dataSource={rows}
              rowSelection={{
                selectedRowKeys: selected,
                onChange: (keys) => setSelected(keys as string[]),
                getCheckboxProps: (row) => ({
                  disabled: !isSelectable(row),
                  name: row.item.rewriteResolved ? row.item.id : `unresolved-${row.item.id}`,
                }),
              }}
              columns={[
                {
                  title: "问题",
                  dataIndex: "question",
                  render: (_: unknown, row) => (
                    <Space size={4} align="start" style={{ width: "100%" }}>
                      {!row.item.rewriteResolved && (
                        <Tooltip title={UNRESOLVED_REASON}>
                          <Tag color="orange" style={{ marginTop: 4 }}>
                            指代未消解
                          </Tag>
                        </Tooltip>
                      )}
                      <Input
                        size="small"
                        aria-label={`问题 ${row.item.id}`}
                        placeholder={
                          row.item.rewriteResolved ? "问题" : "改写成可独立检索的问题"
                        }
                        value={row.question}
                        onChange={(e) => {
                          const question = e.target.value;
                          patchRow(row.item.id, { question });
                          // 改成空的就自动取消勾选：留着一个勾着的空行会在提交时才 400。
                          if (!question.trim()) {
                            setSelected((prev) => prev.filter((id) => id !== row.item.id));
                          }
                        }}
                      />
                    </Space>
                  ),
                },
                {
                  title: "gold 要点（草稿）",
                  dataIndex: "goldPoints",
                  width: 300,
                  render: (_: unknown, row) => {
                    if (row.draft === "loading") return <Spin size="small" />;
                    if (row.draft === "failed") {
                      return (
                        <Space size={4}>
                          <Tag color="red">草拟失败</Tag>
                          <Button size="small" type="link" onClick={() => void retryDraft(row)}>
                            重试
                          </Button>
                        </Space>
                      );
                    }
                    if (row.goldPoints.length === 0) {
                      /**
                       * idle 态**必须给一个触发入口**：未消解的行进第②步时 question 是空的
                       * （刻意不预填指代原文），会被 `draftAll` 的过滤跳过而停在 idle。
                       * 用户人工改写之后，若这里只渲染一句静态文字，那批**最需要帮助的行**
                       * 就永远拿不到 gold 草稿，只能空 gold 入集。
                       */
                      return row.question.trim() ? (
                        <Button size="small" type="link" onClick={() => void retryDraft(row)}>
                          草拟 gold
                        </Button>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          未草拟（进集后为待补 gold）
                        </Text>
                      );
                    }
                    return (
                      <Space size={2} wrap>
                        <Tag color="blue">草稿</Tag>
                        <Text style={{ fontSize: 12 }}>{row.goldPoints.join("；")}</Text>
                      </Space>
                    );
                  },
                },
              ]}
            />
          )}
        </div>
      )}

      {step === 2 && (
        <div>
          <div style={{ fontSize: 12, marginBottom: 6 }}>目标评测集</div>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: "100%" }}
            placeholder="选择要加入的评测集"
            value={setId}
            onChange={(v) => {
              setSetId(v);
              setErr(null);
            }}
            options={sets.map((s) => ({ value: s.id, label: s.name }))}
            popupRender={(menu) => (
              <>
                {menu}
                <Divider style={{ margin: "8px 0" }} />
                <Space.Compact style={{ width: "100%", padding: "0 8px 4px" }}>
                  <Input
                    placeholder="新建评测集名称"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <Button loading={creating} onClick={() => void createSet()}>
                    新建
                  </Button>
                </Space.Compact>
              </>
            )}
          />
          <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
            将加入 {selected.length} 条，状态为「待审核」，审核通过前不参与评测运行
          </Text>
        </div>
      )}
    </Modal>
  );
}
