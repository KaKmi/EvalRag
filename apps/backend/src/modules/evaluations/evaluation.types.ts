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

export interface MetricResult {
  score: number;
  evidence: string[];
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
