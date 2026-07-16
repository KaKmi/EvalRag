import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Flex,
  Popconfirm,
  Progress,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
  type TableColumnsType,
} from "antd";
import { Link, useParams } from "react-router-dom";
import type {
  EvalMetricKey,
  EvalRunReport,
  EvalRunResult,
  EvalRunStatus,
  EvalVerdict,
} from "@codecrush/contracts";
import { getEvalRunReport, stopEvalRun } from "../../api/client";

const { Title, Text } = Typography;

/** 原型 §7 屏3「评测报告」/ §17.3 组件与状态矩阵 / §18.A 状态机 / §19.2 文案。 */

const POLL_MS = 3000;

const RUN_STATUS_LABEL: Record<EvalRunStatus, string> = {
  queued: "排队",
  running: "运行中",
  done: "完成",
  partial: "部分完成",
  budget_stop: "预算中断",
  failed: "失败",
};
const RUN_STATUS_COLOR: Record<EvalRunStatus, string | undefined> = {
  queued: undefined,
  running: "processing",
  done: "green",
  partial: "gold",
  budget_stop: "orange",
  failed: "red",
};

/** §7 判定 + 018 §11 补全的 timeout/unscored（后两者不进 pass/weak/low 分母）。 */
const VERDICT_LABEL: Record<EvalVerdict, string> = {
  pass: "通过",
  weak: "偏低",
  low: "低分",
  timeout: "超时",
  unscored: "未评⚠",
};
const VERDICT_COLOR: Record<EvalVerdict, string | undefined> = {
  pass: "green",
  weak: "gold",
  low: "red",
  timeout: "volcano",
  unscored: undefined,
};

const METRIC_LABEL: Record<EvalMetricKey, string> = {
  faithfulness: "忠实度",
  answerRelevancy: "相关性",
  correctness: "正确率",
  contextPrecision: "精确率",
};

/** W2b 未实现的 4 项（018 决策 E）：不实现、不隐藏——按原型自带空态规则显示「—」。 */
const PENDING_RETRIEVAL_METRICS = ["Context Recall", "NDCG@5", "命中率@5"];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** 判定档位配色（018 §11 / 契约：<60 low、60-79 weak、≥80 pass）。null 不着色。 */
function scoreColor(score: number | null): string | undefined {
  if (score === null) return undefined;
  if (score < 60) return "#ff4d4f";
  if (score < 80) return "#faad14";
  return "#52c41a";
}

/** 分数单元格：**null 一律「—」，绝不是 0**（本波中心不变式）。 */
function ScoreCell({ score, metric }: { score: number | null; metric: EvalMetricKey }) {
  return (
    <span data-testid={`cell-${metric}`} style={{ color: scoreColor(score) }}>
      {score === null ? "—" : score}
    </span>
  );
}

type Row = EvalRunResult & { skipped: boolean };

export default function EvalRunDetailPage() {
  const { runId = "" } = useParams();
  const [report, setReport] = useState<EvalRunReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<EvalMetricKey | "min">("min");
  const [evidenceOf, setEvidenceOf] = useState<Row | null>(null);
  const [stopping, setStopping] = useState(false);

  const load = useCallback(async () => {
    try {
      setReport(await getEvalRunReport(runId));
    } catch (error) {
      // §17：失败保留上次数据，不清空不白屏（轮询期间尤其重要）
      message.error(error instanceof Error ? error.message : "评测报告加载失败");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  // §17.3：queued/running 时 3s 轮询；终态清 interval（018 已知取舍 8：轮询而非 SSE）。
  const status = report?.run.status;
  useEffect(() => {
    if (status !== "queued" && status !== "running") return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [status, load]);

  const rows = useMemo<Row[]>(() => {
    if (!report) return [];
    const results: Row[] = report.results.map((item) => ({ ...item, skipped: false }));
    // 未跑到的用例不写结果行（018 §10）→ 由 skipped 数组补成灰行，指标全「—」。
    const skipped: Row[] = report.skipped.map((item) => ({
      ...item,
      faithfulness: null,
      answerRelevancy: null,
      contextPrecision: null,
      correctness: null,
      minMetric: null,
      minScore: null,
      verdict: "unscored" as const,
      evidence: {},
      previewTraceId: null,
      answer: "",
      durationMs: 0,
      error: null,
      skipped: true,
    }));
    const score = (row: Row) => (sortKey === "min" ? row.minScore : row[sortKey]);
    return [...results, ...skipped].sort((a, b) => {
      // 未跑的恒沉底：它不是「差」，是「没测」。
      if (a.skipped !== b.skipped) return a.skipped ? 1 : -1;
      const [x, y] = [score(a), score(b)];
      // 「坏的浮顶」：升序；未评（null）无分可比 → 沉到已评样本之后。
      if (x === null && y === null) return a.seq - b.seq;
      if (x === null) return 1;
      if (y === null) return -1;
      return x - y || a.seq - b.seq;
    });
  }, [report, sortKey]);

  const stop = async () => {
    setStopping(true);
    try {
      await stopEvalRun(runId);
      message.success("已请求停止");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "停止失败");
    } finally {
      setStopping(false);
    }
  };

  if (loading && !report) {
    return (
      <Flex justify="center" style={{ padding: 64 }}>
        <Spin />
      </Flex>
    );
  }
  if (!report) return <Empty description="评测报告不存在" />;

  const { run, scorecard } = report;
  const percent = run.totalCases > 0 ? Math.round((run.doneCases / run.totalCases) * 100) : 0;

  const columns: TableColumnsType<Row> = [
    { title: "#", dataIndex: "seq", key: "seq", width: 56 },
    {
      title: "问题",
      dataIndex: "question",
      key: "question",
      render: (text: string, row) => (
        <span style={{ color: row.skipped ? "rgba(0,0,0,.45)" : undefined }}>{text}</span>
      ),
    },
    ...(["faithfulness", "answerRelevancy", "correctness", "contextPrecision"] as const).map(
      (metric) => ({
        title: METRIC_LABEL[metric],
        key: metric,
        width: 90,
        render: (_: unknown, row: Row) => <ScoreCell metric={metric} score={row[metric]} />,
      }),
    ),
    {
      title: "判定",
      key: "verdict",
      width: 100,
      // §17.3「判定筛选：低分/偏低/通过/未评/超时」（+ 未跑：stop/budget_stop 的剩余用例）
      filters: [
        { text: "低分", value: "low" },
        { text: "偏低", value: "weak" },
        { text: "通过", value: "pass" },
        { text: "未评", value: "unscored" },
        { text: "超时", value: "timeout" },
        { text: "未跑", value: "skipped" },
      ],
      onFilter: (value, row) => (value === "skipped" ? row.skipped : !row.skipped && row.verdict === value),
      render: (_: unknown, row) =>
        row.skipped ? (
          <Tag style={{ margin: 0 }}>未跑</Tag>
        ) : (
          <Tag color={VERDICT_COLOR[row.verdict]} style={{ margin: 0 }}>
            {VERDICT_LABEL[row.verdict]}
          </Tag>
        ),
    },
    {
      title: "操作",
      key: "action",
      width: 150,
      render: (_: unknown, row) =>
        row.skipped ? (
          <Text type="secondary">—</Text>
        ) : (
          <Flex gap={10}>
            {/* 原型 §7：「trace」= 评测与 Trace 的直接接点（preview trace 详情） */}
            {row.previewTraceId ? (
              <Link to={`/admin/traces/${row.previewTraceId}`}>trace</Link>
            ) : (
              <Text type="secondary">trace</Text>
            )}
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: "auto" }}
              onClick={() => setEvidenceOf(row)}
            >
              判分依据
            </Button>
          </Flex>
        ),
    },
  ];

  return (
    <div>
      <Flex align="center" gap={12} wrap style={{ marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0, marginRight: "auto" }}>
          评测报告
        </Title>
        <Link to="/admin/eval/runs">← 返回评测列表</Link>
      </Flex>

      {/* 原型 §7 概要条：评测集 × 版本 · 时间 · 状态 ｜ 通过/低分 · 耗时 · tokens */}
      <Card size="small" style={{ marginBottom: 8 }}>
        <Flex justify="space-between" gap={12} wrap style={{ fontSize: 12 }}>
          <Space12>
            <span>
              {run.setName} × <b>{run.configVersionLabel}</b> · {formatDateTime(run.createdAt)}
            </span>
            <Tag color={RUN_STATUS_COLOR[run.status]} style={{ margin: 0 }}>
              {RUN_STATUS_LABEL[run.status]}
            </Tag>
          </Space12>
          <Space12>
            <b style={{ color: "#52c41a" }}>通过 {scorecard.passCount}</b>
            <b style={{ color: "#ff4d4f" }}>低分 {scorecard.lowCount}</b>
            {scorecard.weakCount > 0 && <span>偏低 {scorecard.weakCount}</span>}
            {/* 018 已知取舍 2：超时/未评必须显眼，否则「全崩」会被误读成「没测」 */}
            {scorecard.timeoutCount > 0 && (
              <b style={{ color: "#d4380d" }}>超时 {scorecard.timeoutCount}</b>
            )}
            {scorecard.unscoredCount > 0 && <span>未评 {scorecard.unscoredCount}</span>}
            {scorecard.skippedCount > 0 && <span>未跑 {scorecard.skippedCount}</span>}
            <span>{formatDuration(run.durationMs)}</span>
            {/* 018 决策 G：token 是尽力而为，必须写明口径，不假装精确 */}
            <Tooltip title="token 用量为已知上报之和，部分 provider 不回传">
              <span>{Math.round(run.tokensUsed / 1000)}k tokens</span>
            </Tooltip>
          </Space12>
        </Flex>
      </Card>

      <StatusBanner
        report={report}
        percent={percent}
        stopping={stopping}
        onStop={stop}
      />

      {/* 记分卡两块（原型 §7：检索层 / 生成层）。点某指标 → 逐用例表按该指标升序（§17.3）。 */}
      <Flex gap={8} wrap style={{ marginBottom: 8 }}>
        <Card size="small" style={{ flex: "1 1 320px" }} title={<span style={{ color: "#1677ff" }}>检索层</span>}>
          <Flex wrap gap={8}>
            <MetricCell
              label="Context Precision"
              metric="contextPrecision"
              aggregate={scorecard.retrieval.contextPrecision}
              active={sortKey === "contextPrecision"}
              onClick={() => setSortKey("contextPrecision")}
            />
            {PENDING_RETRIEVAL_METRICS.map((label) => (
              <PendingMetricCell key={label} label={label} total={run.totalCases} />
            ))}
          </Flex>
        </Card>
        <Card size="small" style={{ flex: "1 1 320px" }} title={<span style={{ color: "#722ed1" }}>生成层</span>}>
          <Flex wrap gap={8}>
            <MetricCell
              label="Faithfulness"
              metric="faithfulness"
              aggregate={scorecard.generation.faithfulness}
              active={sortKey === "faithfulness"}
              onClick={() => setSortKey("faithfulness")}
            />
            <MetricCell
              label="Relevancy"
              metric="answerRelevancy"
              aggregate={scorecard.generation.answerRelevancy}
              active={sortKey === "answerRelevancy"}
              onClick={() => setSortKey("answerRelevancy")}
            />
            <MetricCell
              label="Correctness"
              metric="correctness"
              aggregate={scorecard.generation.correctness}
              active={sortKey === "correctness"}
              onClick={() => setSortKey("correctness")}
            />
            <PendingMetricCell label="Citation" total={run.totalCases} />
          </Flex>
        </Card>
      </Flex>

      <Card
        size="small"
        title="逐用例"
        extra={
          <Text type="secondary" style={{ fontSize: 12 }}>
            {sortKey === "min" ? "按最差指标升序（坏的浮顶）" : `按 ${METRIC_LABEL[sortKey]} 升序`}
            {sortKey !== "min" && (
              <Button type="link" size="small" onClick={() => setSortKey("min")}>
                恢复默认
              </Button>
            )}
          </Text>
        }
      >
        <Table<Row>
          rowKey={(row) => `${row.caseId}-${row.caseVersion}`}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description="暂无用例结果" /> }}
          // skipped 灰行（§17.3）
          onRow={(row) => (row.skipped ? { style: { background: "#fafafa" } } : {})}
        />
      </Card>

      <EvidenceDrawer row={evidenceOf} onClose={() => setEvidenceOf(null)} />
    </div>
  );
}

/** 概要条内的小间距行——避免为一处布局引入 antd Space 的额外包裹语义。 */
function Space12({ children }: { children: ReactNode }) {
  return (
    <Flex align="center" gap={12} wrap>
      {children}
    </Flex>
  );
}

/** §17.3「运行中横幅」+「非『完成』状态报告顶部横幅说明」（§7 run 状态机行）。 */
function StatusBanner({
  report,
  percent,
  stopping,
  onStop,
}: {
  report: EvalRunReport;
  percent: number;
  stopping: boolean;
  onStop: () => Promise<void>;
}) {
  const { run, scorecard } = report;
  if (run.status === "done") return null;

  if (run.status === "queued" || run.status === "running") {
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 8 }}
        title={run.status === "queued" ? "排队中，等待执行" : `运行中 · ${run.doneCases}/${run.totalCases}`}
        description={<Progress percent={percent} status="active" />}
        action={
          <Popconfirm
            // §19.2 逐字：「停止后已完成的 {n} 条保留，未运行的不再执行？」
            title={`停止后已完成的 ${run.doneCases} 条保留，未运行的不再执行？`}
            okText="停止"
            cancelText="取消"
            okButtonProps={{ danger: true, loading: stopping }}
            onConfirm={onStop}
          >
            <Button size="small" danger>
              停止
            </Button>
          </Popconfirm>
        }
      />
    );
  }

  const banner: Record<"partial" | "budget_stop" | "failed", { type: "warning" | "error"; text: string }> = {
    // §18.A：「手动停止，已完成 23/50」+ 剩余标 skipped
    partial: {
      type: "warning",
      text: `手动停止，已完成 ${run.doneCases}/${run.totalCases}${
        scorecard.skippedCount > 0 ? ` · ${scorecard.skippedCount} 条未跑` : ""
      }`,
    },
    // §18.A：「预算中断(500k)」
    budget_stop: {
      type: "warning",
      text: `预算中断（${Math.round(run.tokenBudget / 1000)}k）· 已完成 ${run.doneCases}/${run.totalCases}${
        scorecard.skippedCount > 0 ? ` · ${scorecard.skippedCount} 条未跑` : ""
      }`,
    },
    failed: { type: "error", text: run.error ?? "评测失败" },
  };
  const { type, text } = banner[run.status];
  return <Alert type={type} showIcon style={{ marginBottom: 8 }} title={text} />;
}

type Aggregate = { value: number | null; scoredCount: number; total: number };

/** 已实现指标：分数 + 覆盖率（avg 只按非 NULL 样本算，覆盖率显性表达「未评」占比）。 */
function MetricCell({
  label,
  metric,
  aggregate,
  active,
  onClick,
}: {
  label: string;
  metric: EvalMetricKey;
  aggregate: Aggregate;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={`点击按${METRIC_LABEL[metric]}升序排列逐用例`}>
      <Flex
        vertical
        gap={2}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") onClick();
        }}
        style={{
          flex: "1 1 130px",
          cursor: "pointer",
          padding: "4px 8px",
          borderRadius: 6,
          background: active ? "#f0f5ff" : undefined,
        }}
      >
        <Text style={{ fontSize: 12 }}>{label}</Text>
        <b data-testid={`scorecard-${metric}`} style={{ fontSize: 18, color: scoreColor(aggregate.value) }}>
          {aggregate.value === null ? "—" : aggregate.value}
        </b>
        <Text type="secondary" style={{ fontSize: 11 }}>
          已评 {aggregate.scoredCount}/{aggregate.total}
        </Text>
      </Flex>
    </Tooltip>
  );
}

/**
 * W2b 未实现的指标（018 决策 E）——**不隐藏**，按原型 §7 自带的空态规则展示：
 * 「检索层指标显示『—』并注『未标 gold docs』；记分卡该项旁标覆盖率」。
 */
function PendingMetricCell({ label, total }: { label: string; total: number }) {
  return (
    <Flex vertical gap={2} style={{ flex: "1 1 130px", padding: "4px 8px" }}>
      <Text style={{ fontSize: 12 }}>{label}</Text>
      <b style={{ fontSize: 18, color: "rgba(0,0,0,.25)" }}>—</b>
      <Text type="secondary" style={{ fontSize: 11 }}>
        <span>未标 gold docs</span> · 已评 0/{total}
      </Text>
    </Flex>
  );
}

/** correctness 的 evidence 行形如 `[hit] 要点原文 —— 理由`（correctness.evaluator.ts:103）。 */
const POINT_STATUS: Record<string, { label: string; color: string }> = {
  hit: { label: "一致", color: "green" },
  missing: { label: "缺失", color: "gold" },
  contradicted: { label: "矛盾", color: "red" },
};

/** §17.3「判分依据抽屉 Drawer 560px · eval_results.judge_evidence」。 */
function EvidenceDrawer({ row, onClose }: { row: Row | null; onClose: () => void }) {
  return (
    <Drawer title={`判分依据 · #${row?.seq ?? ""}`} width={560} open={row !== null} onClose={onClose}>
      {row && (
        <>
          <Text strong>{row.question}</Text>
          {row.error && (
            <Alert type="error" showIcon style={{ marginTop: 8 }} title={row.error} />
          )}
          {row.answer && (
            <Card size="small" title="回答" style={{ marginTop: 8 }}>
              <Text style={{ whiteSpace: "pre-wrap" }}>{row.answer}</Text>
            </Card>
          )}
          {(["faithfulness", "answerRelevancy", "correctness", "contextPrecision"] as const).map(
            (metric) => {
              const lines = row.evidence[metric];
              return (
                <Card
                  key={metric}
                  size="small"
                  style={{ marginTop: 8 }}
                  title={
                    <Flex align="center" gap={8}>
                      <span>{METRIC_LABEL[metric]}</span>
                      <b style={{ color: scoreColor(row[metric]) }}>
                        {row[metric] === null ? "—" : row[metric]}
                      </b>
                    </Flex>
                  }
                >
                  {/*
                    「未评」的判据是**分数为 NULL**，不是 evidence 键缺失：契约里
                    evidence 只收评出来的指标（partialRecord），但反过来「有分无依据」
                    也可能发生（如 contextPrecision 无检索片段时的兜底），那不是未评。
                  */}
                  {row[metric] === null ? (
                    <Text type="secondary">该指标未评——裁判失败/超时/无 gold 可对照，不计入均值</Text>
                  ) : lines === undefined || lines.length === 0 ? (
                    <Text type="secondary">本次未返回判分依据</Text>
                  ) : (
                    lines.map((line, index) => <EvidenceLine key={index} line={line} />)
                  )}
                </Card>
              );
            },
          )}
        </>
      )}
    </Drawer>
  );
}

function EvidenceLine({ line }: { line: string }) {
  const matched = /^\[(\w+)]\s*(.*)$/s.exec(line);
  const status = matched ? POINT_STATUS[matched[1]] : undefined;
  return (
    <Flex gap={8} style={{ marginBottom: 6 }}>
      {status && (
        <Tag color={status.color} style={{ margin: 0, height: 22 }}>
          {status.label}
        </Tag>
      )}
      <Text style={{ fontSize: 12 }}>{status ? matched?.[2] : line}</Text>
    </Flex>
  );
}
