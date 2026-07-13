import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { CODECRUSH_IO, CODECRUSH_REDACTED } from "@codecrush/otel-conventions";

/**
 * M8 T3 §5 落库 PII 脱敏：在 span 离开进程前（OTLP 导出前）scrub 内容承载字段里的敏感信息，
 * 并打「已脱敏」标记。这是应用 → OTLP → Collector → ClickHouse 链路的应用侧最后一环——
 * 落 ClickHouse 前的信任边界咽喉（004 §包边界「@codecrush/otel 负责脱敏钩子」）。
 * 脱敏集中在此，业务代码只写原文，不散落脱敏逻辑。
 *
 * SpanExporter.export 的回调结果类型：@opentelemetry/core 的 ExportResult。此处用结构类型
 * 而非直接 import——@opentelemetry/core 非本包直接依赖（pnpm 隔离 node_modules 下可能不解析）；
 * 运行时形状即 { code: number }（0=SUCCESS）。
 */
type ExportResultLike = { code: number; error?: Error };

// 启发式 PII 正则（首版；真实规则应可配置——见 013 Revisit）。子串替换（保留其余文本），非整段丢弃。
// 身份证在银行卡之前处理（18 位纯数字优先判身份证）。
const SIMPLE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[REDACTED_EMAIL]"],
  [/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[REDACTED_PHONE]"], // 中国大陆手机号
  [/(?<!\d)\d{17}[\dxX](?!\d)/g, "[REDACTED_ID]"], // 18 位身份证（末位可 X）
];

// 银行卡候选：13–19 位连续数字。**必须 Luhn 校验通过才脱敏**——否则 13 位 Unix 毫秒时间戳、
// 13–19 位订单号/运单号会被误当卡号脱掉（review Finding 1：污染 trace 正文 + 误报 redacted）。
// 真实银行卡按 Luhn 构造必过；随机长数字过 Luhn 概率低，误伤大幅下降。
const CARD_CANDIDATE = /(?<!\d)\d{13,19}(?!\d)/g;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48; // '0'..'9'
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** 对单段文本脱敏；返回替换后文本与是否发生替换。无 PII 时原样返回、redacted=false。 */
export function redactPii(text: string): { text: string; redacted: boolean } {
  let out = text;
  let redacted = false;
  for (const [re, placeholder] of SIMPLE_PATTERNS) {
    const next = out.replace(re, placeholder);
    if (next !== out) {
      redacted = true;
      out = next;
    }
  }
  const carded = out.replace(CARD_CANDIDATE, (m) => (luhnValid(m) ? "[REDACTED_CARD]" : m));
  if (carded !== out) {
    redacted = true;
    out = carded;
  }
  return { text: out, redacted };
}

/** 就地 scrub attributes 中指定 key 的字符串值（非字符串值跳过）；返回是否发生任何替换。 */
export function redactAttributes(attrs: Record<string, unknown>, keys: Iterable<string>): boolean {
  let changed = false;
  for (const key of keys) {
    const v = attrs[key];
    if (typeof v === "string") {
      const r = redactPii(v);
      if (r.redacted) {
        attrs[key] = r.text;
        changed = true;
      }
    }
  }
  return changed;
}

/** 默认脱敏内容承载 key 集：通用 IO 输入/输出。 */
export const DEFAULT_REDACT_KEYS: readonly string[] = [CODECRUSH_IO.INPUT, CODECRUSH_IO.OUTPUT];

/**
 * 装饰底层 SpanExporter：导出前对每 span 的内容承载 key 脱敏，命中则打 codecrush.redacted 标记。
 * 就地 mutate span.attributes（SDK Span 的活对象引用，flush 时同一对象——已 spike 验证生效）。
 * 埋点绝不进关键路径（004 Invariant 3）：脱敏任何异常都被吞、绝不阻断导出。
 */
export class RedactingSpanExporter implements SpanExporter {
  constructor(
    private readonly inner: SpanExporter,
    private readonly keys: readonly string[] = DEFAULT_REDACT_KEYS,
  ) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResultLike) => void): void {
    for (const span of spans) {
      try {
        const attrs = span.attributes as Record<string, unknown>;
        if (redactAttributes(attrs, this.keys)) {
          attrs[CODECRUSH_REDACTED] = true;
        }
      } catch {
        // 脱敏失败绝不阻断导出（best-effort，埋点不进关键路径）
      }
    }
    this.inner.export(spans, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}
