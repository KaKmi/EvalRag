import { Injectable, Logger } from "@nestjs/common";
import {
  CHAT_INTENT_KEY,
  INTENT_TABLE,
  type ChatCitation,
  type ChatStreamEvent,
  type FallbackInfo,
  type FallbackReason,
  type ResolvedApplicationConfig,
  type ResolvedNodeConfig,
} from "@codecrush/contracts";
import { startManualSpan, runInContext, SpanStatusCode } from "@codecrush/otel";
import {
  CODECRUSH_IO,
  CODECRUSH_SPAN_KIND,
  ENDUSER_ID,
  GEN_AI,
  RAG,
  SESSION_ID,
} from "@codecrush/otel-conventions";
import { ApplicationsService } from "../applications/applications.service";
import { NodeRuntimeService } from "../node-runtime/executor/node-runtime.service";
import { RetrievalService } from "../retrieval/retrieval.service";
import { KnowledgeBasesService } from "../knowledge-bases/knowledge-bases.service";
import { ConversationsService } from "../conversations/conversations.service";
import { buildRetrievalRequests, mergeHits, type TaggedHit } from "./retrieval-mapping";
import {
  decideFallback,
  deriveConfidence,
  deriveCoverage,
  deriveQualitySignals,
  resolveRetrievalKbIds,
} from "./derived-metrics";
import { FALLBACK_THRESHOLD } from "./orchestration.constants";
import type { OrchestrationResult } from "./orchestration.types";

const TITLE_MAX = 30;
const HISTORY_MAX_MESSAGES = 6;

/** 预备阶段（rewrite→intent→路由→检索→判定）的产物，供流式阶段消费。全在首个 yield 前算完。 */
interface PrepResult {
  branch: "reply" | "fallback";
  citations: ChatCitation[];
  retrievalContext: string;
  history?: string;
  validConvId?: string;
  isFallback: boolean;
  reasons: FallbackReason[];
  fallbackInfo: FallbackInfo;
  /**
   * 018 决策 C：命中分块原文（含真实 chunkId / finalScore），供离线评测喂 Judge。
   * 内部结构，**不进 SSE 契约**（ChatCitation 没有 chunkId，且 text 可选——拼不出 Judge 输入）。
   * 兜底/CHAT 分支为 []。
   */
  hits: TaggedHit[];
}

type TokenUsage = { inputTokens: number; outputTokens: number };

/** 018 决策 C：`runWithConfig` 的加性选项。全部省略 → 行为与 E-W2a 之前逐字节一致。 */
interface RunWithConfigOptions {
  /** false = 跳过全部 persist（决策 C-2：离线 run 不落会话，避免污染会话表）。默认 true。 */
  persist?: boolean;
  /** 非空 → chain 根 span 标 `rag.eval.run_id`（原型 §6）。**不是**发 rag.eval span。 */
  evalRunId?: string;
  /**
   * chain 根 span 一建立即回调 traceId。离线专用：`done` 事件也带 traceId，但**超时路径没有
   * done** —— 而超时恰恰是最需要「trace」链接去看卡在哪的时候。故不能只依赖 done。
   */
  onTrace?: (traceId: string) => void;
  /** 预备阶段产物回调（离线取 hits）。 */
  onPrep?: (prep: PrepResult) => void;
  /** 编排累计 token 回调（决策 G：让 usage 出进程做预算熔断）。 */
  onUsage?: (usage: TokenUsage) => void;
}

/** 018 决策 C：`runForEvaluation` 的返回值——离线 run 引擎构造 Judge 输入所需的一切。 */
export interface EvaluationRunOutcome {
  traceId: string;
  replyText: string;
  /** 真实 chunkId/text/finalScore —— 禁止合成 c1/c2（Global Constraints）。 */
  hits: Array<{ chunkId: string; text: string; finalScore: number }>;
  usage: TokenUsage;
  isFallback: boolean;
  timedOut: boolean;
}

interface ExecuteNodeOptions {
  spanEnrich?: (output: unknown) => Record<string, string | number | boolean>;
  onUsage?: (usage: TokenUsage) => void;
  onRepair?: (retryCount: number) => void;
}

class ChainMetricsAccumulator {
  private readonly prepUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  private readonly replyUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  private model = "";
  private repairAttemptCount = 0;
  private repairEligibleCount = 0;
  private ttftMs?: number;
  private generationDurationMs?: number;
  private retrievalExecutionCount = 0;
  private keywordRequestedCount = 0;
  private rerankRequestedCount = 0;
  private keywordDegradedCount = 0;
  private rerankDegradedCount = 0;

  readonly replyObserver = {
    onModel: (model: string) => {
      this.model = model;
    },
    onUsage: (usage: TokenUsage) => {
      this.replyUsage.inputTokens = usage.inputTokens;
      this.replyUsage.outputTokens = usage.outputTokens;
    },
    onGenerationTiming: (timing: { ttftMs?: number; generationDurationMs: number }) => {
      this.ttftMs = timing.ttftMs;
      this.generationDurationMs = timing.generationDurationMs;
    },
  };

  readonly addPrepUsage = (usage: TokenUsage): void => {
    this.prepUsage.inputTokens += usage.inputTokens;
    this.prepUsage.outputTokens += usage.outputTokens;
  };

  readonly addRepair = (retryCount: number): void => {
    this.repairEligibleCount += 1;
    if (retryCount > 0) this.repairAttemptCount += 1;
  };

  readonly addRetrieval = (keywordRequested: boolean, rerankRequested: boolean): void => {
    this.retrievalExecutionCount += 1;
    if (keywordRequested) this.keywordRequestedCount += 1;
    if (rerankRequested) this.rerankRequestedCount += 1;
  };

  readonly addDegradation = (signal: "keyword_degraded" | "rerank_degraded"): void => {
    if (signal === "keyword_degraded") this.keywordDegradedCount += 1;
    else this.rerankDegradedCount += 1;
  };

  captureReply(usage?: TokenUsage, model?: string): void {
    if (usage) this.replyObserver.onUsage(usage);
    if (model) this.replyObserver.onModel(model);
  }

  /**
   * 018 决策 G：把已累计的 token 用量读出进程（原先只写进 span 属性，run 引擎拿不到）。
   * 口径与 `applyTo` 完全一致（prep + reply）。provider 未回传 usage 的部分恒为 0——
   * 尽力而为，不估算、不假装精确。
   */
  totals(): TokenUsage {
    return {
      inputTokens: this.prepUsage.inputTokens + this.replyUsage.inputTokens,
      outputTokens: this.prepUsage.outputTokens + this.replyUsage.outputTokens,
    };
  }

  applyTo(span: { setAttribute(key: string, value: string | number): void }): void {
    const inputTokens = this.prepUsage.inputTokens + this.replyUsage.inputTokens;
    const outputTokens = this.prepUsage.outputTokens + this.replyUsage.outputTokens;
    if (inputTokens > 0) span.setAttribute(GEN_AI.USAGE_INPUT_TOKENS, inputTokens);
    if (outputTokens > 0) span.setAttribute(GEN_AI.USAGE_OUTPUT_TOKENS, outputTokens);
    if (this.model) span.setAttribute(GEN_AI.REQUEST_MODEL, this.model);
    span.setAttribute(RAG.REPAIR_ATTEMPT_COUNT, this.repairAttemptCount);
    span.setAttribute(RAG.REPAIR_ELIGIBLE_COUNT, this.repairEligibleCount);
    span.setAttribute(RAG.RETRIEVAL_EXECUTION_COUNT, this.retrievalExecutionCount);
    span.setAttribute(RAG.KEYWORD_REQUESTED_COUNT, this.keywordRequestedCount);
    span.setAttribute(RAG.RERANK_REQUESTED_COUNT, this.rerankRequestedCount);
    span.setAttribute(RAG.DEGRADED_KEYWORD_RECALL_COUNT, this.keywordDegradedCount);
    span.setAttribute(RAG.DEGRADED_RERANK_COUNT, this.rerankDegradedCount);
    if (this.ttftMs !== undefined) span.setAttribute(RAG.TTFT_MS, this.ttftMs);
    if (this.generationDurationMs !== undefined) {
      span.setAttribute(RAG.GENERATION_DURATION_MS, this.generationDurationMs);
      const postFirstTokenMs = this.generationDurationMs - (this.ttftMs ?? this.generationDurationMs);
      if (this.replyUsage.outputTokens > 0 && postFirstTokenMs > 0) {
        span.setAttribute(
          RAG.GENERATION_TOKENS_PER_SECOND,
          this.replyUsage.outputTokens / (postFirstTokenMs / 1000),
        );
      }
    }
  }
}

/**
 * M8 RAG 编排内核（013 §编排 + 014 意图路由）：
 * resolvePublic → rewrite → intent → 路由映射 → 逐 KB 检索合并 → 生成/兜底 → 派生指标 → 落库。
 * chain 根 span 用 startManualSpan 手动生命周期（跨 yield 存活），子 span 经 runInContext 显式挂父。
 * T2 逐 token 真流式：run() 返回 AsyncGenerator<ChatStreamEvent>，reply 走 streamTextChunks 逐 token yield。
 */
@Injectable()
export class OrchestrationService {
  private readonly logger = new Logger(OrchestrationService.name);

  constructor(
    private readonly applications: ApplicationsService,
    private readonly nodeRuntime: NodeRuntimeService,
    private readonly retrieval: RetrievalService,
    private readonly kbs: KnowledgeBasesService,
    private readonly conversations: ConversationsService,
  ) {}

  async *run(
    agentId: string,
    query: string,
    convId?: string,
    userId?: string,
  ): AsyncGenerator<ChatStreamEvent> {
    // resolvePublic 在 chain span 之外：未上线/停用异常直接冒泡给 controller 翻 404/403（写头之前）。
    // 必须留在生成器体内（首个 next() 时才触发）——chat.controller.ts:52-53 依赖此时序。
    // yield* 委托保持该时序不变。
    const cfg = await this.applications.resolvePublic(agentId);
    yield* this.runWithConfig(agentId, cfg, query, convId, userId);
  }

  /**
   * 018 决策 C：编排主体（自 chain span 起）。原 `run()` 的全部逻辑**纯搬移**至此，零行为变化。
   *
   * `agentId` **必须**是独立首参、**不得**改用 `cfg.applicationId` 推导：入参可能是 slug，
   * 且它是会话归属 IDOR 校验的判据（`resolveConvId` 里 `conv.agentId !== agentId`）。
   * 既有测试的 fixture 恰好 `applicationId === agentId`，**抓不到**这个 divergence——
   * 换句话说，这里没有测试守护，只能靠不改。
   */
  private async *runWithConfig(
    agentId: string,
    cfg: ResolvedApplicationConfig,
    query: string,
    convId?: string,
    userId?: string,
    opts?: RunWithConfigOptions,
  ): AsyncGenerator<ChatStreamEvent> {
    // chain 根 span 用手动生命周期：跨 yield 存活，finally 手动 end（withSpan 撑不住流式）。
    const { span: chain, ctx: chainCtx } = startManualSpan("rag.pipeline", {
      attributes: {
        "codecrush.span.kind": CODECRUSH_SPAN_KIND.CHAIN,
        [RAG.PROMPT_VERSION_ID]: cfg.configVersionId,
        [RAG.PREVIEW]: cfg.preview,
      },
    });
    // 018 决策 B：给编排 trace 打 run 标记（原型 §6）。写在 rag.pipeline 上 → 不进 eval MV。
    if (opts?.evalRunId) chain.setAttribute(RAG.EVAL_RUN_ID, opts.evalRunId);
    const traceId = chain.spanContext().traceId;
    opts?.onTrace?.(traceId); // 离线：超时路径无 done 事件，traceId 只能从这里拿
    // M8 T3：输入即得，起始即记（通用 IO 属性；导出前经 RedactingSpanExporter 脱敏）
    chain.setAttribute(CODECRUSH_IO.INPUT, query);
    // M9 W1：身份富化——agentId/userId 入口即得，cfg.name 已解析；session.id 须待 persist 出真 convId（见 finally）。
    // 埋点写规范应用 id（cfg.applicationId）而非调用方原始入参：入参可为 slug 或 UUID，
    // 若原样落到 gen_ai.agent.id 会让同一应用按 slug/UUID 拆成多份，污染分应用质量/指标聚合。
    chain.setAttribute(GEN_AI.AGENT_ID, cfg.applicationId);
    chain.setAttribute(GEN_AI.AGENT_NAME, cfg.name);
    if (userId) chain.setAttribute(ENDUSER_ID, userId);
    // 首轮新会话的真实 convId 在 persist() 内 createConversation 才产生 → 捕获返回、finally end 前写 session.id。
    let sessionId = "";
    let replyText = "";
    const metrics = new ChainMetricsAccumulator();
    let completed = false;
    let prep: PrepResult | undefined;
    let persistCtx: { agentId: string; query: string; convId?: string; userId?: string } | undefined;
    // reply 迭代器提到外层：手动 next() 循环不像 for-await 那样自动传播 return()，故 finally
    // 显式 return() 级联取消上游（streamTextChunks → chatStream → reader.cancel）+ 结束 reply span。
    let replyIt: AsyncGenerator<{ delta: string }, unknown> | undefined;
    // 018 决策 C-2：离线 run 不落会话——persist 在每条完成路径都会调用，而 conversations
    // 表没有 preview/source 列，一个 50 题的 run 会灌 50 行与真实用户会话不可区分。
    // 默认 true → 线上路径的 4 处 persist 调用逐字节不变。
    const shouldPersist = opts?.persist !== false;
    const maybePersist = async (
      result: OrchestrationResult,
      ctx: { agentId: string; query: string; convId?: string; userId?: string },
    ): Promise<string | undefined> => (shouldPersist ? this.persist(result, ctx) : undefined);
    // M8 T3：所有结束路径统一写 output + 四质量布尔（每路径恰一次；prep 未就绪的 infra 早失败不写）。
    let signalsWritten = false;
    // reply 分支模型输出未过契约校验 → streamTextChunks 返回 outcome=fallback（把兜底话术当整段）；
    // 这也是「生成拒答」，但不在 prep.isFallback（那是检索层兜底判定）里——单独记，供 refusal 信号。
    let replyDegraded = false;
    const finalizeChainSignals = (timedOut: boolean): void => {
      if (signalsWritten || !prep) return;
      signalsWritten = true;
      chain.setAttribute(CODECRUSH_IO.OUTPUT, replyText);
      const sig = deriveQualitySignals({
        // refusal = 检索层兜底 或 reply 节点契约降级（两类"生成拒答"都算，对齐 docstring）
        isFallback: prep.isFallback || replyDegraded,
        reasons: prep.reasons,
        citationCount: prep.citations.length,
        timedOut,
      });
      chain.setAttribute(RAG.QUALITY_LOW_RECALL, sig.lowRecall);
      chain.setAttribute(RAG.QUALITY_NO_CITATIONS, sig.noCitations);
      chain.setAttribute(RAG.QUALITY_REFUSAL, sig.refusal);
      chain.setAttribute(RAG.QUALITY_TIMEOUT, sig.timeout);
      // M9 W1：兜底状态判据——检索层未命中走兜底话术（区别于 refusal=isFallback||replyDegraded，PDF「兜底=知识未命中」）
      chain.setAttribute(RAG.FALLBACK_USED, prep.isFallback);
      const marks = new Set([...replyText.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
      const citedScores = prep.citations.filter((c) => marks.has(c.n)).map((c) => c.score);
      const confidence = prep.isFallback
        ? undefined
        : deriveConfidence(citedScores.length ? citedScores : prep.citations.slice(0, 1).map((c) => c.score));
      if (confidence !== undefined) chain.setAttribute(RAG.QUALITY_CONFIDENCE, confidence);
      chain.setAttribute(RAG.CITATION_COUNT, prep.citations.length);
      chain.setAttribute(
        RAG.CITATION_COVERAGE,
        deriveCoverage(replyText, prep.citations.length, prep.isFallback),
      );
      // M9 W2 D2：引用角标↔命中分块（n 编号跨 KB 合并后才产生，只活在 prep.citations）——落根 span 供详情引用面板纯 CH 驱动。
      // 兜底/CHAT 分支 citations 为 []。RAG.CITATION_IDS 常量首次真实落地。
      chain.setAttribute(
        RAG.CITATION_IDS,
        JSON.stringify(
          prep.citations.map((c) => ({ n: c.n, doc: c.doc, section: c.section, score: c.score })),
        ),
      );
    };

    try {
      // —— 预备阶段：整段在 chainCtx 内（内部无 yield），子 span（rewrite/intent/检索）自动挂 chain ——
      prep = await runInContext(chainCtx, () =>
        this.prepare(agentId, query, convId, cfg, metrics),
      );
      persistCtx = { agentId, query, convId: prep.validConvId, userId };
      opts?.onPrep?.(prep); // 018 决策 C：把 hits 交给离线评测（在线路径无回调 → no-op）

      // —— 流式阶段 ——
      for (const c of prep.citations) yield { type: "citation", citation: c };

      if (prep.branch === "fallback") {
        // 兜底/CHAT：整段（streamText，无 delta 可吐），单 token yield
        const text = await runInContext(chainCtx, () => this.streamNode(cfg.nodes.fallback, "fallback"));
        replyText = text;
        if (text) yield { type: "token", delta: text };
      } else {
        // 正常 reply：逐 token 真流式（streamTextChunks），reply LLM span 显式挂父到 chainCtx。
        const it = this.nodeRuntime.streamTextChunks(
          "reply",
          cfg.nodes.reply.contractVersion,
          cfg.nodes.reply.promptBody,
          cfg.nodes.reply.modelId,
          { query, history: prep.history, retrievalContext: prep.retrievalContext },
          { citations: prep.citations },
          {
            temperature: cfg.nodes.reply.temperature,
            metricsObserver: metrics.replyObserver,
          },
          chainCtx,
        );
        replyIt = it; // 供 finally 级联 return()（abort 时取消上游 + 结束 reply span，AC6）
        try {
          let res = await it.next();
          while (!res.done) {
            replyText += res.value.delta;
            yield { type: "token", delta: res.value.delta };
            res = await it.next();
          }
          const summary = res.value;
          metrics.captureReply(summary.usage, summary.model);
          if (summary.outcome === "timeout") {
            // 降级路径也要在后端日志留痕（不只 span），否则无 ClickHouse 时排查无迹（QA 观察 2）。
            this.logger.warn(`reply 首 token 超时熔断（agentId=${agentId}, traceId=${traceId}）`);
            chain.setStatus({ code: SpanStatusCode.ERROR, message: "first token timeout" });
            finalizeChainSignals(true); // 唯一 timedOut=true 路径（其余路径由 finally 写 false）
            yield { type: "error", message: "生成超时，请稍后重试" };
            sessionId = (await maybePersist(this.buildResult(traceId, "", prep), persistCtx)) ?? persistCtx?.convId ?? sessionId;
            completed = true;
            return; // 熔断：不发 done
          }
          if (summary.outcome === "fallback") {
            // reply 节点降级：把 reply 契约 fallback 文本当整段（同 T1 streamNode 语义），branch 仍算 reply
            replyDegraded = true; // 记为「生成拒答」→ refusal 质量信号（review Finding 1）
            replyText = summary.text;
            if (summary.text) yield { type: "token", delta: summary.text };
          }
          // ok / partial：replyText 已逐 token 累加
        } catch (err) {
          // reply 节点 infra 失败（模型被删/协议不支持 → resolveModel 抛；或提示词非法字段 →
          // assembleMessages 抛）发生在首帧后，HTTP 头已发，不能截断流 → 优雅降级为 error 事件收尾
          // （对齐 timeout；不冒泡截断，review Finding 2）。
          // 除记 span 外必须写后端日志：该路径不 rethrow，Nest 异常过滤器看不到它，无 ClickHouse
          // 时将完全无迹可查（QA 观察 2——真实环境靠此定位过提示词非法字段 {context}）。
          this.logger.error(
            `reply 生成失败降级（agentId=${agentId}, traceId=${traceId}）：${(err as Error).message}`,
          );
          chain.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
          chain.recordException(err as Error);
          yield { type: "error", message: "生成失败，请稍后重试" };
          sessionId = (await maybePersist(this.buildResult(traceId, replyText, prep), persistCtx)) ?? persistCtx?.convId ?? sessionId;
          completed = true;
          return;
        }
      }

      // —— 派生指标 + 落库 + done（先 persist+completed，再 yield，杜绝 yield 处 abort 致重复落库）——
      const result = this.buildResult(traceId, replyText, prep);
      const persistedConvId = await maybePersist(result, persistCtx);
      sessionId = persistedConvId ?? persistCtx?.convId ?? sessionId; // M9 W1：首轮取 persist 生成的真 convId
      const doneConvId = persistedConvId ?? prep.validConvId; // 可能 undefined（落库彻底失败）
      completed = true;
      chain.setStatus({ code: SpanStatusCode.OK });
      yield {
        type: "done",
        traceId,
        // M8 T4：契约 convId 可选——有值才带（新会话回填/续聊定位），落库失败时省略不发空串
        ...(doneConvId ? { convId: doneConvId } : {}),
        confidence: result.confidence,
        coverage: result.coverage,
        isFallback: result.isFallback,
        fallbackReasons: result.fallbackReasons,
      };
    } catch (err) {
      // 预备阶段异常（infra 级）在首个 yield 前发生 → 记 span 并冒泡给 controller（写头前 → 500）。
      chain.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      chain.recordException(err as Error);
      throw err;
    } finally {
      if (!completed && persistCtx && prep) {
        // 客户端 abort（gen.return()）：落已产出部分 assistant 内容（复用现有字段，无 aborted 列）。
        try {
          sessionId = (await maybePersist(this.buildResult(traceId, replyText, prep), persistCtx)) ?? persistCtx?.convId ?? sessionId;
        } catch (e) {
          this.logger.error(`abort 落部分失败（边界7 兜住）：${(e as Error).message}`);
        }
      }
      // 手动 next() 循环不自动传播 return()：显式级联 return reply 迭代器，触发 streamTextChunks
      // 的 finally（reader.cancel + reply span.end），避免 abort 时上游 fetch 悬挂/span 泄漏（Finding 1）。
      // 对已读完/已抛错/已 return 的迭代器是安全 no-op。try 包裹保证 return 万一 reject 也不跳过 chain.end。
      try {
        if (replyIt) await replyIt.return?.(undefined);
      } catch (e) {
        this.logger.warn(`reply 迭代器 return 级联异常（忽略）：${(e as Error).message}`);
      }
      // M8 T3：非 timeout 路径（正常/reply-fail/abort）在此统一写 output + 四质量布尔 timedOut=false；
      // timeout 路径已在熔断处 finalize(true)，signalsWritten 去重保证不被覆盖。prep 未就绪的 infra
      // 早失败（prepare 抛）prep=undefined，finalize guard 跳过（早失败无质量信号可言）。
      finalizeChainSignals(false);
      // M9 W1：session.id 待此写——首轮新会话的真 convId 已由各 persist 路径捕获进 sessionId。
      // 决策 C-2 的已知代价：离线 run 跳过 persist → sessionId 恒空 → eval trace 无 session.id。
      if (sessionId) chain.setAttribute(SESSION_ID, sessionId);
      metrics.applyTo(chain);
      // 018 决策 G：usage 出进程供预算熔断（在线路径无回调 → no-op）。
      // 放在 applyTo 之后、end 之前：口径与写进 span 的完全一致。
      opts?.onUsage?.(metrics.totals());
      chain.end(); // 手动生命周期：所有路径必 end
    }
  }

  /**
   * 018 决策 C：离线评测专用只读入口。与线上**同一份** `runWithConfig` 代码路径
   * （原型 §6「与线上完全同路径」），只是：用调用方给的 cfg（preview=true 的显式版本）、
   * 不落会话、给 chain span 打 run 标记、把 hits/usage 带出来。
   *
   * **不发 `rag.eval` span**（018 决策 B）——那会污染屏1；离线分数存 PG。
   *
   * 超时不抛：返回 `timedOut: true`，run 引擎据此记 `verdict=timeout` + 分数全 NULL，
   * 并继续跑下一条用例。
   */
  async runForEvaluation(
    cfg: ResolvedApplicationConfig,
    query: string,
    opts: { runId: string; timeoutMs: number },
  ): Promise<EvaluationRunOutcome> {
    let prep: PrepResult | undefined;
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let traceId = "";
    let replyText = "";
    let timedOut = false;

    // 此处传 cfg.applicationId 作 agentId 是安全的（018 决策 C 已论证）：离线不传 convId
    // → resolveConvId 首行短路，走不到归属校验；且 persist 已跳过，无写入归属。
    const gen = this.runWithConfig(cfg.applicationId, cfg, query, undefined, undefined, {
      persist: false,
      evalRunId: opts.runId,
      onTrace: (id) => {
        traceId = id;
      },
      onPrep: (p) => {
        prep = p;
      },
      onUsage: (u) => {
        usage = u;
      },
    });

    // 超时用 Promise.race 包住**每次** next()：单个 case 的墙钟上限。
    // 超时后必须 gen.return() 级联取消上游（同 controller 断连路径——chat.controller.ts:49-51），
    // 否则 streamTextChunks 的 fetch 悬挂 + reply span 泄漏。
    const deadline = Date.now() + opts.timeoutMs;
    try {
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          timedOut = true;
          break;
        }
        let timer: NodeJS.Timeout | undefined;
        const tick = await Promise.race([
          gen.next(),
          new Promise<"timeout">((resolve) => {
            timer = setTimeout(() => resolve("timeout"), remaining);
          }),
        ]).finally(() => {
          if (timer) clearTimeout(timer);
        });

        if (tick === "timeout") {
          timedOut = true;
          break;
        }
        if (tick.done) break;

        const event = tick.value;
        if (event.type === "token") replyText += event.delta;
      }
    } finally {
      // 对已读完/已抛错的生成器是安全 no-op；超时路径靠它触发 finally（span end + 上游取消）。
      try {
        await gen.return(undefined);
      } catch (err) {
        this.logger.warn(`eval 生成器 return 级联异常（忽略）：${(err as Error).message}`);
      }
    }

    return {
      traceId,
      replyText,
      hits: (prep?.hits ?? []).map((h) => ({
        chunkId: h.chunkId,
        text: h.text,
        finalScore: h.finalScore,
      })),
      usage,
      isFallback: prep?.isFallback ?? false,
      timedOut,
    };
  }

  /** 预备阶段：rewrite→intent→路由→检索→兜底判定，产出 PrepResult。无 yield，供 runInContext 包裹挂父。 */
  private async prepare(
    agentId: string,
    query: string,
    convId: string | undefined,
    cfg: Awaited<ReturnType<ApplicationsService["resolvePublic"]>>,
    metrics: ChainMetricsAccumulator,
  ): Promise<PrepResult> {
    const kbRows = await this.kbs.findByIds(cfg.kbIds);
    const kbNameById = new Map(kbRows.map((k) => [k.id, k.name]));
    // review P2：convId 归属校验——客户端自报的 convId 若属于别的 agentId，不得读其历史
    // 或写入其消息（跨应用会话串号）；不属于/不存在均按未传 convId 处理，降级新建会话。
    const validConvId = await this.resolveConvId(agentId, convId);
    const history = await this.loadHistory(validConvId);

    // 1) rewrite：降级时契约 fallback 已回填原 query
    const rewrite = await this.executeNode<{ rewrittenQuery: string }>(
      cfg.nodes.rewrite,
      "rewrite",
      { query, history },
      {},
      { onUsage: metrics.addPrepUsage, onRepair: metrics.addRepair },
    );
    const rewrittenQuery = rewrite.rewrittenQuery;

    // 2) intent：候选恒注入静态全表（014 D3）
    //    M9：把「意图分类 + 路由 KB 名」写到 intent 节点自己的 span（详情面板显示「意图 → 路由到 X 库」）。
    //    route 是 intent 的纯函数，enrich 内按 output.intent 重算——CHAT 短路不检索故路由为空。
    const intentOut = await this.executeNode<{ intent: string }>(
      cfg.nodes.intent,
      "intent",
      { query, history },
      { availableIntents: INTENT_TABLE },
      {
        spanEnrich: (out) => {
          const cls = (out as { intent: string }).intent;
          const kbNames =
            cls === CHAT_INTENT_KEY
              ? []
              : resolveRetrievalKbIds(cls, cfg, kbRows).map((id) => kbNameById.get(id) ?? id);
          return { [RAG.INTENT]: cls, [RAG.ROUTE_KB_NAMES]: JSON.stringify(kbNames) };
        },
        onUsage: metrics.addPrepUsage,
        onRepair: metrics.addRepair,
      },
    );
    const intent = intentOut.intent;

    // 3) CHAT 短路：不检索，直走兜底（014 D4）
    if (intent === CHAT_INTENT_KEY) {
      const reasons: FallbackReason[] = ["chitchat", "handled_by_fallback"];
      return {
        branch: "fallback",
        citations: [],
        retrievalContext: "",
        history,
        validConvId,
        isFallback: true,
        reasons,
        fallbackInfo: { reasons, scopeKbNames: [] },
        hits: [], // CHAT 短路不检索
      };
    }

    // 4) 路由映射 + 逐 KB 检索 + 合并去重（保持 routeKbIds 顺序，去重同分保留先到组）
    const routeKbIds = resolveRetrievalKbIds(intent, cfg, kbRows);
    const reqs = buildRetrievalRequests({
      query: rewrittenQuery,
      routeKbIds,
      embedModelId: kbRows[0]?.embeddingModelId ?? "",
      retrieval: cfg.retrieval,
    });
    const perKb = await Promise.all(
      reqs.map(async (r) => {
        metrics.addRetrieval(r.multi, Boolean(r.rerankModelId));
        return {
          kbId: r.kbId,
          hits: (await this.retrieval.test(r, metrics.addDegradation)).hits,
        };
      }),
    );
    const hits: TaggedHit[] = mergeHits(perKb).slice(0, cfg.retrieval.topN);

    // 5) 兜底判定：rerank 开启时用 rerankThreshold（缺省回退平台阈值）
    const threshold = cfg.retrieval.rerankEnabled
      ? (cfg.retrieval.rerankThreshold ?? FALLBACK_THRESHOLD)
      : FALLBACK_THRESHOLD;
    const scopeKbNames = routeKbIds.map((id) => kbNameById.get(id) ?? id);
    const decision = decideFallback({
      topScore: hits[0]?.finalScore,
      hitCount: hits.length,
      threshold,
      scopeKbNames,
    });
    const fallbackInfo: FallbackInfo = {
      reasons: decision.reasons,
      topScore: decision.topScore,
      threshold: decision.threshold,
      scopeKbNames: decision.scopeKbNames,
    };

    if (decision.isFallback) {
      return {
        branch: "fallback",
        citations: [],
        retrievalContext: "",
        history,
        validConvId,
        isFallback: true,
        reasons: decision.reasons,
        fallbackInfo,
        // 检索层兜底：命中未过阈值 → 不喂给生成，也不作为判分依据（与 citations=[] 同口径）
        hits: [],
      };
    }

    const citations: ChatCitation[] = hits.map((h, i) => ({
      n: i + 1,
      doc: h.docName,
      kb: kbNameById.get(h.kbId) ?? "",
      section: h.section,
      score: h.finalScore,
      text: h.text, // M8 T4：命中段正文回传前端右栏
    }));
    const retrievalContext = hits.map((h, i) => `[${i + 1}] ${h.text}`).join("\n\n");
    return {
      branch: "reply",
      citations,
      retrievalContext,
      history,
      validConvId,
      isFallback: false,
      reasons: [],
      fallbackInfo,
      hits, // 018 决策 C：真实命中（含 chunkId/finalScore），与 citations 1:1 同序
    };
  }

  /** 派生指标（F3：从正文 [n] 反查被引用 citation 的 score）+ 组装 OrchestrationResult（内部累加器）。 */
  private buildResult(traceId: string, replyText: string, prep: PrepResult): OrchestrationResult {
    const marks = new Set([...replyText.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
    const citedScores = prep.citations.filter((c) => marks.has(c.n)).map((c) => c.score);
    const confidence = prep.isFallback
      ? undefined
      : deriveConfidence(citedScores.length ? citedScores : prep.citations.slice(0, 1).map((c) => c.score));
    const coverage = deriveCoverage(replyText, prep.citations.length, prep.isFallback);
    return {
      traceId,
      replyText,
      citations: prep.citations,
      confidence,
      coverage,
      isFallback: prep.isFallback,
      fallbackReasons: prep.reasons,
      fallbackInfo: prep.fallbackInfo,
    };
  }

  private async executeNode<TOutput>(
    node: ResolvedNodeConfig,
    name: "rewrite" | "intent",
    input: Record<string, unknown>,
    reserved: unknown,
    options: ExecuteNodeOptions = {},
  ): Promise<TOutput> {
    const r = await this.nodeRuntime.executeStructured<Record<string, unknown>, TOutput, unknown>(
      name,
      node.contractVersion,
      node.promptBody,
      node.modelId,
      input,
      reserved,
      {
        temperature: node.temperature,
        spanEnrich: options.spanEnrich,
        metricsObserver: options.onRepair ? { onRepair: options.onRepair } : undefined,
      },
    );
    if (r.usage) options.onUsage?.(r.usage);
    return r.output;
  }

  private async streamNode(
    node: ResolvedNodeConfig,
    name: "reply" | "fallback",
    payload: { input?: Record<string, unknown>; reserved?: unknown } = {},
  ): Promise<string> {
    const r = await this.nodeRuntime.streamText(
      name,
      node.contractVersion,
      node.promptBody,
      node.modelId,
      payload.input ?? {},
      payload.reserved ?? {},
      { temperature: node.temperature },
    );
    return r.text;
  }

  /**
   * review P2：校验 convId 归属当前 agentId，防跨应用会话读写（IDOR）——客户端自报的 convId
   * 若实际属于别的 agentId，会话历史不得被读进当前应用的提示词、也不得被追加消息。
   * 不存在/不属于/查询失败均按未传 convId 处理（降级新建会话），不冒泡为请求失败。
   */
  private async resolveConvId(agentId: string, convId?: string): Promise<string | undefined> {
    if (!convId) return undefined;
    try {
      const conv = await this.conversations.get(convId);
      if (conv.agentId !== agentId) {
        this.logger.warn(
          `convId ${convId} 不属于 agentId ${agentId}（实际属于 ${conv.agentId}）——拒绝跨应用复用，按新会话处理`,
        );
        return undefined;
      }
      return convId;
    } catch (err) {
      this.logger.warn(`convId ${convId} 校验失败（${(err as Error).message}），按新会话处理`);
      return undefined;
    }
  }

  /** 历史注入：读会话既有消息（尾部 N 条）拼接为 "role: content" 行；失败降级 undefined。 */
  private async loadHistory(convId?: string): Promise<string | undefined> {
    if (!convId) return undefined;
    try {
      const msgs = await this.conversations.listMessages(convId);
      if (msgs.length === 0) return undefined;
      return msgs
        .slice(-HISTORY_MAX_MESSAGES)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");
    } catch (err) {
      this.logger.warn(`加载会话历史失败（降级为无历史）：${(err as Error).message}`);
      return undefined;
    }
  }

  /** 落库（user+assistant）——边界 7：持久化异常兜住不冒泡为 500，降级仍返回回答。 */
  private async persist(
    result: OrchestrationResult,
    a: { agentId: string; query: string; convId?: string; userId?: string },
  ): Promise<string | undefined> {
    // review P3：convId 声明在 try 外层（非 const）——若 createConversation 已成功但后续
    // appendMessage 失败，catch 分支能返回这个刚创建的会话 id，而不是回退到调用方原始
    // 入参（新会话场景下是 undefined），避免已落库的会话在异常路径里“丢失”。
    let convId = a.convId;
    try {
      if (!convId) {
        convId = (
          await this.conversations.createConversation({
            agentId: a.agentId,
            userId: a.userId,
            title: a.query.slice(0, TITLE_MAX),
          })
        ).id;
      }
      await this.conversations.appendMessage({ convId, role: "user", content: a.query });
      await this.conversations.appendMessage({
        convId,
        role: "assistant",
        content: result.replyText,
        traceId: result.traceId,
        confidence: result.confidence,
        coverage: result.coverage,
        isFallback: result.isFallback,
        fallbackInfo: result.fallbackInfo,
        citations: result.citations.map((c) => String(c.n)),
      });
      return convId;
    } catch (err) {
      this.logger.error(`会话落库失败（降级继续返回回答）：${(err as Error).message}`);
      return convId;
    }
  }
}
