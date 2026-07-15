import { Injectable } from "@nestjs/common";
import { AnswerRelevancyEvaluator } from "./answer-relevancy.evaluator";
import { ContextPrecisionEvaluator } from "./context-precision.evaluator";
import type { EvaluationInput, EvaluationModelIds, EvaluationScores } from "./evaluation.types";
import { FaithfulnessEvaluator } from "./faithfulness.evaluator";

@Injectable()
export class EvaluationJudgeService {
  constructor(
    private readonly faithfulness: FaithfulnessEvaluator,
    private readonly answerRelevancy: AnswerRelevancyEvaluator,
    private readonly contextPrecision: ContextPrecisionEvaluator,
  ) {}

  async score(input: EvaluationInput, modelIds: EvaluationModelIds): Promise<EvaluationScores> {
    const faithfulness = await this.faithfulness.score(input, modelIds.judgeModelId);
    const answerRelevancy = await this.answerRelevancy.score(input, modelIds);
    const contextPrecision = await this.contextPrecision.score(input, modelIds.judgeModelId);
    return {
      faithfulness: faithfulness.score,
      answerRelevancy: answerRelevancy.score,
      contextPrecision: contextPrecision.score,
      evidence: {
        faithfulness: faithfulness.evidence,
        answerRelevancy: answerRelevancy.evidence,
        contextPrecision: contextPrecision.evidence,
      },
    };
  }
}
