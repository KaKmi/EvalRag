import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { AppConfigService } from "../../platform/config/config.service";
import {
  EVALUATION_QUEUE,
  ONLINE_EVALUATION_JOB,
  ONLINE_EVALUATION_WORKER,
} from "../../platform/queue/queue.constants";
import type { Queue } from "../../platform/queue/queue.port";
import { ModelsService } from "../models/models.service";
import {
  ClickHouseEvaluationsRepository,
  type EvaluationCandidate,
} from "./clickhouse-evaluations.repository";
import {
  EVALUATION_CANDIDATE_LIMIT,
  EVALUATION_FAILURE_CIRCUIT_LIMIT,
  EVALUATION_LAG_BUFFER_MS,
  EVALUATION_LEASE_MS,
} from "./evaluation.constants";
import { EvaluationInputService } from "./evaluation-input.service";
import { EvaluationJudgeService } from "./evaluation-judge.service";
import { EvaluationSpanEmitter } from "./evaluation-span.emitter";
import { normalizeEvaluationError } from "./evaluation-worker.errors";
import { EvaluationsRepository } from "./evaluations.repository";
import {
  classifyRisk,
  effectiveNormalRate,
  isFaithfulnessEligible,
  stableSample,
} from "./sampling";

const WorkerPayloadSchema = z.strictObject({ workerName: z.string().min(1).max(100) });

export type CandidateOutcomeKind =
  | "success"
  | "already_scored"
  | "sampled_out"
  | "quota_skipped_normal"
  | "incomplete"
  | "processed_failed"
  | "cap_deferred"
  | "circuit_deferred";

export interface CandidateOutcome {
  traceId: string;
  startTime: Date;
  agentId: string;
  kind: CandidateOutcomeKind;
  advancesCursor: boolean;
  error?: string | null;
}

export interface CycleResult {
  status: "disabled" | "lease_busy" | "model_unavailable" | "healthy" | "budget_reduced";
  outcomes: CandidateOutcome[];
  cursor?: { lastTs: Date; lastTraceId: string };
  evaluatedCount: number;
  skippedCount: number;
  failedCount: number;
}

function outcome(
  candidate: EvaluationCandidate,
  kind: CandidateOutcomeKind,
  advancesCursor = true,
  error: string | null = null,
): CandidateOutcome {
  return {
    traceId: candidate.traceId,
    startTime: candidate.startTime,
    agentId: candidate.agentId,
    kind,
    advancesCursor,
    error,
  };
}

@Injectable()
export class EvaluationWorkerProcessor implements OnModuleInit {
  private readonly logger = new Logger(EvaluationWorkerProcessor.name);

  constructor(
    @Inject(EVALUATION_QUEUE) private readonly queue: Queue,
    private readonly repo: EvaluationsRepository,
    private readonly clickhouse: ClickHouseEvaluationsRepository,
    private readonly input: EvaluationInputService,
    private readonly judge: EvaluationJudgeService,
    private readonly emitter: EvaluationSpanEmitter,
    private readonly models: ModelsService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * 冷启动播种点——只在水位线那行不存在时生效。`-1` = 全部历史（epoch）。
   * 注意 `dailyCap` 仍然封顶：历史多时分多天评完，不会一次灌爆预算。
   */
  private seedFrom(now: Date): Date {
    const hours = this.config.onlineEvalBackfillWindowHours;
    return hours < 0 ? new Date(0) : new Date(now.getTime() - hours * 60 * 60 * 1000);
  }

  async onModuleInit(): Promise<void> {
    await this.queue.subscribe(ONLINE_EVALUATION_JOB, async (data) => {
      const payload = WorkerPayloadSchema.parse(data);
      try {
        await this.processCycle(payload.workerName);
      } catch (error) {
        const normalized = normalizeEvaluationError(error);
        await this.repo.recordFailure(
          payload.workerName,
          normalized.errorClass,
          normalized.message,
        );
        throw error;
      }
    });
    await this.queue.schedule(
      ONLINE_EVALUATION_JOB,
      "*/15 * * * *",
      { workerName: ONLINE_EVALUATION_WORKER },
      { tz: "UTC", key: ONLINE_EVALUATION_WORKER, retryLimit: 1 },
    );
  }

  async processCycle(workerName: string, now = new Date()): Promise<CycleResult> {
    const settings = await this.repo.getSettings();
    if (!settings.enabled || settings.sampleRate === 0) return this.emptyResult("disabled");
    if (
      !(await this.modelsAvailable(workerName, settings.judgeModelId, settings.embeddingModelId))
    ) {
      return this.emptyResult("model_unavailable");
    }

    const owner = randomUUID();
    const seedFrom = this.seedFrom(now);
    if (!(await this.repo.tryAcquireLease(workerName, owner, now, EVALUATION_LEASE_MS, seedFrom))) {
      return this.emptyResult("lease_busy");
    }

    try {
      const watermark = await this.repo.getOrCreateWatermark(workerName, now, seedFrom);
      const candidates = await this.clickhouse.listCandidates(
        watermark,
        new Date(now.getTime() - EVALUATION_LAG_BUFFER_MS),
        EVALUATION_CANDIDATE_LIMIT,
      );
      const outcomes: CandidateOutcome[] = [];
      const riskSuffix = this.riskSuffix(candidates);
      let dailyCount = watermark.dailyCount;
      let consecutiveJudgeFailures = 0;
      let lastError: string | null = null;
      // 本轮有没有真的调过裁判。判据不能用「有没有候选」——一轮 500 条全 sampled_out 同样
      // 没碰过裁判，同样无权改写裁判的健康状态。
      let judgeAttempted = false;

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        if (consecutiveJudgeFailures >= EVALUATION_FAILURE_CIRCUIT_LIMIT) {
          outcomes.push(outcome(candidate, "circuit_deferred", false));
          continue;
        }
        const risk = classifyRisk(candidate);
        const remainingCapacity = Math.max(0, settings.dailyCap - dailyCount);
        if (risk && remainingCapacity === 0) {
          outcomes.push(outcome(candidate, "cap_deferred", false));
          continue;
        }
        if (!risk) {
          const rate = effectiveNormalRate(settings.sampleRate, dailyCount, settings.dailyCap);
          if (!stableSample(candidate.traceId, settings.judgeVersion, rate)) {
            outcomes.push(outcome(candidate, "sampled_out"));
            continue;
          }
          if (remainingCapacity <= riskSuffix[index]) {
            outcomes.push(outcome(candidate, "quota_skipped_normal"));
            continue;
          }
        }

        if (await this.clickhouse.findExisting(candidate.traceId, settings.judgeVersion)) {
          outcomes.push(outcome(candidate, "already_scored"));
          continue;
        }
        const assembled = await this.input.assemble(candidate);
        if (assembled.status === "incomplete") {
          outcomes.push(outcome(candidate, "incomplete"));
          continue;
        }
        judgeAttempted = true;
        try {
          const result = await this.judge.score(
            assembled.input,
            {
              judgeModelId: settings.judgeModelId!,
              embeddingModelId: settings.embeddingModelId!,
            },
            {
              skipFaithfulness: !isFaithfulnessEligible(candidate),
            },
          );
          await this.emitter.emitSuccess({
            candidate,
            input: assembled.input,
            settings: {
              judgeModelId: settings.judgeModelId!,
              judgeVersion: settings.judgeVersion,
            },
            result,
          });
          dailyCount += 1;
          consecutiveJudgeFailures = 0;
          lastError = null;
          outcomes.push(outcome(candidate, "success"));
        } catch (error) {
          const normalized = normalizeEvaluationError(error);
          await this.emitter.emitFailure({
            input: assembled.input,
            settings: {
              judgeModelId: settings.judgeModelId!,
              judgeVersion: settings.judgeVersion,
            },
            error,
          });
          consecutiveJudgeFailures += 1;
          lastError = normalized.message;
          outcomes.push(outcome(candidate, "processed_failed", true, normalized.message));
        }
      }

      let cursor = { lastTs: watermark.lastTs, lastTraceId: watermark.lastTraceId };
      for (const item of outcomes) {
        if (!item.advancesCursor) break;
        cursor = { lastTs: item.startTime, lastTraceId: item.traceId };
      }
      const evaluatedCount = outcomes.filter((item) => item.kind === "success").length;
      await this.repo.finishCycle(workerName, owner, {
        ...cursor,
        evaluatedIncrement: evaluatedCount,
        now,
        // 「跑过」≠「走过」：空转一轮也更新 lastRunAt，游标却可能几天没动。
        cursorMoved:
          cursor.lastTraceId !== watermark.lastTraceId ||
          cursor.lastTs.getTime() !== watermark.lastTs.getTime(),
        // 账本记「worker 对这条 trace 做了什么」——即全部**终态** outcome（6 种推进的），
        // 与游标够不够得着无关（cap/circuit 之后的候选照样被处理，见 finishCycle 注释）。
        // 两个 deferred 不记：它们下一轮会重来，记了就是假账。
        judgeVersion: settings.judgeVersion,
        ledger: outcomes
          .filter((item) => item.advancesCursor)
          .map((item) => ({
            targetTraceId: item.traceId,
            traceStartTime: item.startTime,
            agentId: item.agentId,
            outcome: item.kind,
            lastError: item.error,
          })),
        // 没动过裁判就不上报裁判健康状态（传 undefined ⇒ finishCycle 不碰那两列），
        // 否则空轮会把上一次真实故障擦成 0/null。
        ...(judgeAttempted ? { consecutiveFailures: consecutiveJudgeFailures, lastError } : {}),
      });
      await this.pruneLedger(now);
      const status =
        dailyCount >= Math.floor(settings.dailyCap * 0.8) ? "budget_reduced" : "healthy";
      return {
        status,
        outcomes,
        cursor,
        evaluatedCount,
        skippedCount: outcomes.filter((item) =>
          ["already_scored", "sampled_out", "quota_skipped_normal", "incomplete"].includes(
            item.kind,
          ),
        ).length,
        failedCount: outcomes.filter((item) => item.kind === "processed_failed").length,
      };
    } finally {
      await this.repo.releaseLease(workerName, owner, now);
    }
  }

  /**
   * 账本清理搭本轮的车，不新建 cron（多一个周期任务就多一个要盯的东西）。
   * **绝不让清理失败带垮整轮**：这一轮的评分与游标此时已经落库，为了一次删除失败而把
   * 整个 handler 抛出去，只会让 pg-boss 重投、`recordFailure` 记一笔与评测无关的错，
   * 把「裁判到底健不健康」这个信号搅浑。
   */
  private async pruneLedger(now: Date): Promise<void> {
    const days = this.config.onlineEvalLedgerRetentionDays;
    try {
      const removed = await this.repo.pruneLedger(
        new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
      );
      if (removed > 0) this.logger.log(`账本清理：删除 ${removed} 行（早于 ${days} 天）`);
    } catch (error) {
      this.logger.warn(
        `账本清理失败（不影响本轮评测）：${normalizeEvaluationError(error).message}`,
      );
    }
  }

  private riskSuffix(candidates: EvaluationCandidate[]): number[] {
    const result = new Array<number>(candidates.length).fill(0);
    let count = 0;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      if (classifyRisk(candidates[index])) count += 1;
      result[index] = count;
    }
    return result;
  }

  private async modelsAvailable(
    workerName: string,
    judgeModelId: string | null,
    embeddingModelId: string | null,
  ): Promise<boolean> {
    try {
      if (!judgeModelId || !embeddingModelId) throw new Error("required model id is missing");
      const judge = await this.models.get(judgeModelId);
      if (judge.type !== "llm" || !judge.enabled) throw new Error(`${judgeModelId} is unavailable`);
      const embedding = await this.models.get(embeddingModelId);
      if (embedding.type !== "embedding" || !embedding.enabled) {
        throw new Error(`${embeddingModelId} is unavailable`);
      }
      return true;
    } catch (error) {
      const normalized = normalizeEvaluationError(error);
      const modelIds = [judgeModelId, embeddingModelId].filter(Boolean).join(",") || "missing";
      await this.repo.recordFailure(
        workerName,
        "ModelUnavailable",
        `${modelIds}: ${normalized.message}`.slice(0, 200),
      );
      return false;
    }
  }

  private emptyResult(status: CycleResult["status"]): CycleResult {
    return { status, outcomes: [], evaluatedCount: 0, skippedCount: 0, failedCount: 0 };
  }
}
