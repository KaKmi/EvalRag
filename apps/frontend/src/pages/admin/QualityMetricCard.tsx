import { Card, Statistic, Typography } from "antd";

const { Text } = Typography;

/**
 * 三分指标卡（原型 §17.1 `:581`）。屏1 与运行看板的摘要行**共用这一个实现**。
 *
 * 抽出来的理由不是「省几行」，而是这张卡的四种状态判定必须只有一处：
 *  · 正常
 *  · 超阈值 → 红框 + 红字（`low`）
 *  · **样本不足（n < 20）→ 灰字提示且不显 Δ**（原型 `:226`：避免小样本误读）
 *  · 未评 → 「—」，**绝不显示 0**（0 分与未评是两件事）
 * 看板上若再写第二套，两处迟早给同一个数字不同的判定，而用户会以为是数据在变。
 */

/** 与 `QualityOverviewResponse.metrics[key]` 同形的最小入参（不绑定整个响应类型）。 */
export interface QualityMetricView {
  value: number | null;
  threshold: number;
  low: boolean;
  sampleCount: number;
  previousDelta: number | null;
}

/** 原型 `:226`：窗口内样本少于此值只显「样本不足」，不显趋势 Δ。 */
export const LOW_SAMPLE_MIN = 20;

export interface QualityMetricCardProps {
  label: string;
  metric: QualityMetricView;
  onClick?: () => void;
  /** 屏1 用 `metric-<key>`；看板另给一套，避免两处 testid 撞车。 */
  testId?: string;
  /** 看板摘要行的卡更矮一些；屏1 保持原尺寸。 */
  compact?: boolean;
}

export function QualityMetricCard({
  label,
  metric,
  onClick,
  testId,
  compact = false,
}: QualityMetricCardProps) {
  return (
    <Card
      hoverable={Boolean(onClick)}
      role={onClick ? "button" : undefined}
      data-testid={testId}
      aria-label={`${label} ${metric.value ?? "暂无"}`}
      onClick={onClick}
      style={{ flex: "1 1 200px", borderColor: metric.low ? "#ffccc7" : undefined }}
      styles={{ body: { padding: compact ? 14 : 18 } }}
    >
      <Statistic
        title={label}
        value={metric.value ?? "—"}
        styles={{
          content: { color: metric.low ? "#cf1322" : "#1677ff", fontSize: compact ? 22 : undefined },
        }}
      />
      {metric.sampleCount < LOW_SAMPLE_MIN ? (
        <Text style={{ color: "#d48806" }}>样本不足</Text>
      ) : metric.previousDelta !== null ? (
        <Text type={metric.previousDelta >= 0 ? "success" : "danger"}>
          {metric.previousDelta >= 0 ? "▲" : "▼"} {Math.abs(metric.previousDelta)}
        </Text>
      ) : null}
    </Card>
  );
}

export default QualityMetricCard;
