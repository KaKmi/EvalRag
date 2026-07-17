export interface EvaluationContext {
  chunkId: string;
  text: string;
  finalScore: number;
}

export interface EvaluationInput {
  targetTraceId: string;
  question: string;
  answer: string;
  contexts: EvaluationContext[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface MetricResult {
  score: number;
  evidence: string[];
  /**
   * 018 决策 G：**可选**——`ChatResult.usage` 本身可选（provider 可能不回传）。
   * 在线路径不读它（`EvaluationScores` 结构不变 → E-W1 零影响）；离线用于预算熔断，
   * 缺失时计 0（熔断偏松，如实记录不假装精确）。
   */
  usage?: TokenUsage;
}

/** CorrectnessEvaluator 的输入：在 EvaluationInput 之上多带 gold 要点（离线专用）。 */
export interface CorrectnessInput extends EvaluationInput {
  goldPoints: string[];
}

/**
 * 018 决策 D：离线判分结果——四个指标各自可空。
 * NULL = 未评（裁判失败 / 无 gold）——**绝不写 0**（原型 §6：不拉低均值）。
 * 与在线 `EvaluationScores`（三个必填 number，整体失败语义）刻意分开，互不影响。
 */
export interface OfflineEvaluationScores {
  faithfulness: number | null;
  answerRelevancy: number | null;
  contextPrecision: number | null;
  correctness: number | null;
  /** 只收**评出来**的指标——未评指标无键（对齐契约的 partialRecord）。 */
  evidence: Record<string, string[]>;
  /** 各裁判已上报 usage 之和；缺失部分计 0（决策 G）。 */
  usage: TokenUsage;
}

export interface EvaluationScores {
  faithfulness: number;
  answerRelevancy: number;
  contextPrecision: number;
  evidence: {
    faithfulness: string[];
    answerRelevancy: string[];
    contextPrecision: string[];
  };
}

export interface EvaluationModelIds {
  judgeModelId: string;
  embeddingModelId: string;
}
