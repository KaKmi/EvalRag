import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type {
  DraftGoldRequest,
  DraftGoldResponse,
  PromoteGapRequest,
  PromoteGapResponse,
  PromoteGapWarning,
} from "@codecrush/contracts";
import { DRIZZLE } from "../../platform/persistence/drizzle.constants";
import type { DB } from "../../platform/persistence/persistence.module";
import { EvaluationsRepository } from "../evaluations/evaluations.repository";
import { parseJudgeOutput, structuredOutput } from "../evaluations/evaluation-judge.utils";
import { EvalSetsService } from "../eval-runs/eval-sets.service";
import { ModelsService } from "../models/models.service";
import { cosineSimilarity } from "./gap-clustering";
import { DUPLICATE_COMPARE_CASE_LIMIT, DUPLICATE_SIMILARITY_MIN } from "./gap.constants";
import { normalizeQuestion } from "./gap-triage";
import { GapsRepository } from "./gaps.repository";
import type { GapItemRow } from "./schema";

/**
 * 「从坏样本生成」的服务端一半（021 §17.2 `:596`）：LLM 草拟 gold 要点 + 批量沉淀成 gold 用例。
 *
 * 这是 021 决策 A 里 `gaps → eval-runs` 那条既定边的**唯一**落点：批量建用例必须在服务端
 * 一处完成（前端 N 次 POST 拿不到「要么全进要么都不进」的语义，也没法在成功后打
 * 「已进评测集」标志）。反向的 `eval-runs → gaps` 由 eslint Boundary ⑤ 机械拦住。
 */

/** 草拟结果的形状。3–5 条是 D7 的硬约束，schema 一起钉死——模型少给/多给都当失败重问。 */
const DraftGoldOutputSchema = z.strictObject({
  goldPoints: z.array(z.string().trim().min(1).max(200)).min(3).max(5),
});

const DRAFT_GOLD_OUTPUT = structuredOutput("gap_draft_gold_v1", DraftGoldOutputSchema);

/**
 * 缺口 26 / D7 的**逐字**指令：gold 要点是「必须包含什么」，不是「资料里说过什么」。
 *
 * 这段文案与 Modal 第②步顶部的 Alert 同源——人和模型被同一句话约束，
 * 否则人审时会按「资料说过什么」去改模型给的「必须包含什么」，两边互相拉扯。
 */
const DRAFT_GOLD_SYSTEM_PROMPT = [
  "你在为 RAG 系统的离线评测集起草 gold 要点。",
  "只输出 3–5 条要点，不多不少。",
  "gold 要点 = 「一个好答案**必须**包含什么」，不是「资料里**说过**什么」：",
  "写判定一个答案是否合格的必要条件，不要复述资料原文、不要罗列背景知识。",
  "每条要点一句话、可独立判定对错、不超过 200 字。",
  "只返回 JSON，不要 markdown 代码围栏。",
].join("\n");

/**
 * `eval_cases.source_trace_id` 是 32 位十六进制（契约 `CreateEvalCaseRequestSchema`）。
 * 手动入池的 item 允许更短的 id（`CreateGapItemRequestSchema` 只要 1–32 字符），
 * 带过去会让用例的来源列指向一条打不开的 trace ⇒ 形状不符就不带。
 */
const TRACE_ID = /^[0-9a-f]{32}$/i;

/**
 * 一条待落库的用例，外加只在服务端内部用的两个字段。
 *
 * `itemId` / `force` 随构建 plan 的那次循环**顺手带上**，不事后 `req.items.find(...)` 反查：
 * 反查要靠 itemId 相等去认领，而 `question` 是可以被调用方覆写的，认错一条就把 warning
 * 挂到别人头上。两者都在插入前剥掉（`eval_cases` 没有这两列）。
 */
interface PlanEntry {
  itemId: string;
  force: boolean;
  question: string;
  goldPoints: string[];
  sourceTraceId?: string;
}

/** 目标集既有用例里，本文件唯一用到的两个字段。 */
interface ExistingCase {
  id: string;
  question: string;
}

@Injectable()
export class GapPromoteService {
  constructor(
    private readonly repo: GapsRepository,
    private readonly evaluations: EvaluationsRepository,
    private readonly models: ModelsService,
    private readonly evalSets: EvalSetsService,
    /**
     * 顶层事务的持有者。跨域原子性只能在**调用方**这一层开事务——两个域的仓库各开各的，
     * 拼不出「要么全成要么全滚」（见 `promote` 里的事务块）。
     */
    @Inject(DRIZZLE) private readonly db: DB,
  ) {}

  /**
   * 单条同步草拟。**输入只有 question（+ 可选 answer）**——检索片段正文永不入 prompt（§9.8）：
   * 片段正文是内容面，且「资料里说过什么」正是缺口 26 要压住的 gold 来源。
   *
   * 解析失败/模型报错一律抛可读错误，**绝不编造要点**：一条编出来的 gold 会被人当成
   * 模型读过资料后的判断，比没有 gold 危险得多。
   */
  async draftGold(req: DraftGoldRequest): Promise<DraftGoldResponse> {
    const { judgeModelId } = await this.evaluations.getSettings();
    if (!judgeModelId) {
      throw new BadRequestException("未配置判官模型，无法草拟 gold——请先在在线评测设置里选一个");
    }

    let content: string;
    try {
      const response = await this.models.chat(
        judgeModelId,
        [
          { role: "system", content: DRAFT_GOLD_SYSTEM_PROMPT },
          // 载荷只有这两个键。多一个键就是多一条内容面泄漏路径，故显式构造而非透传 req。
          {
            role: "user",
            content: JSON.stringify({ question: req.question, answer: req.answer ?? "" }),
          },
        ],
        { temperature: 0, structuredOutput: DRAFT_GOLD_OUTPUT },
      );
      content = response.content;
    } catch (error) {
      throw new BadRequestException(
        `草拟失败：判官模型调用出错（${error instanceof Error ? error.message : String(error)}）`,
      );
    }

    try {
      return { goldPoints: parseJudgeOutput(content, DraftGoldOutputSchema).goldPoints };
    } catch (error) {
      // 解析不出来就说解析不出来。给空数组会被前端当成「模型认为没有要点」，
      // 那是把一次失败伪装成一个结论。
      throw new BadRequestException(
        `草拟失败：判官模型未返回合法的 3–5 条要点（${error instanceof Error ? error.message : String(error)}）`,
      );
    }
  }

  /**
   * 批量沉淀。用例状态恒 `draft`（Global Constraint 11：`insertCaseWithVersion` 的默认值，
   * 本方法不提供任何「直接审核通过」的开关——生成物必须过人眼才能参与 run）。
   *
   * 全部落库成功后才打「已进评测集」标志：那是**叠加标志、不改 status**（原型 `:634`）。
   */
  async promote(
    req: PromoteGapRequest,
    /**
     * `eval_cases` 没有 created_by 列，批量路径也没处安放它（同 `createCase` 的 `_actor`）。
     * 形参保留是为了不动 controller 的调用面，也为了 `now` 的位置不变。
     */
    _actor: string,
    now = new Date(),
  ): Promise<PromoteGapResponse> {
    const cluster = await this.repo.findCluster(req.clusterId);
    if (!cluster || cluster.deletedAt !== null) {
      throw new NotFoundException(`缺口不存在：${req.clusterId}`);
    }

    const itemIds = req.items.map((item) => item.itemId);
    const rows = await this.assertItemsBelongTo(req.clusterId, itemIds);
    const byId = new Map(rows.map((row) => [row.id, row]));

    /**
     * 重复检测是**两层**，两层都必要，谁也替代不了谁：
     *  ① **精确层**（这里）：本批内部去重 + 与目标集既有用例按归一化问题精确比对。
     *    `markEnteredEvalSet` 是幂等的「只写一次」语义，簇上有了紫标**照样能再点一次
     *    [进评测集]**，没有这道比对，重试或误点会让同一批问题原样再落一遍，目标集里出现
     *    整批重复的 draft 用例，人审时根本看不出哪条是重复。
     *    它同时把「promote 中途失败后重试」变成安全操作（见下方插入循环的注释）。
     *  ② **语义层**（下面的 `detectSemanticDuplicates`，B2b 补上、收口 021 §12②）：
     *    embedding 余弦 > 0.95 标「疑似重复，与用例 #12 相似」（原型 `:269`）。
     *
     * 精确层零成本且零假阳性，所以放在前面**先筛一遍**——语义层每条候选都要花一次 embed，
     * 让字面完全相同的行走到那一步纯属白花钱。
     */
    const existingCases = await this.evalSets.listCases(req.targetSetId);
    const existing = new Set(existingCases.map((item) => normalizeQuestion(item.question)));
    const seen = new Set<string>();
    const plan: PlanEntry[] = [];

    // **先全量解析、再落库**：决策 G 的守卫会抛 400，若边解析边写就会留下「前 3 条进了、
    // 第 4 条 400」的半批状态——用户看到失败，却已经有用例躺在目标集里。
    for (const item of req.items) {
      const row = byId.get(item.itemId)!;
      const question = this.resolveQuestion(item.question, row);
      const key = normalizeQuestion(question);
      if (seen.has(key) || existing.has(key)) continue;
      seen.add(key);
      plan.push({
        itemId: item.itemId,
        force: item.force ?? false,
        question,
        // 空白要点会满足「reviewed 需 ≥1 条」却无从判起（同 CreateEvalCaseRequestSchema 的口径）。
        goldPoints: item.goldPoints.map((point) => point.trim()).filter(Boolean),
        ...(TRACE_ID.test(row.sourceTraceId) ? { sourceTraceId: row.sourceTraceId } : {}),
      });
    }

    // 语义层。必须跑在事务**外面**：它要发 embedding 网络请求，把一次不定时长的外部调用
    // 圈进事务里，等于按上游延迟持有数据库连接与锁。
    const { kept, warnings, truncated } = await this.detectSemanticDuplicates(plan, existingCases);

    /**
     * **整批用例 + 簇标志一个事务**（021 §12② 的收口）。这是本仓库第一处跨域共享事务：
     * 顶层事务开在这里，同一个 `tx` 分别交给 eval-runs 与 gaps 两个域的方法。
     *
     * B2a 曾逐条 `createCase` 后再单独打标志，中途失败就留下**部分已入集**的状态，
     * 只能靠「重试安全 + 把已建 caseIds 随错误抛回，前端说『已加入 N 条，其余失败』」压低危害。
     * 现在那个状态在数据库层面不存在了，所以那套半批错误处理（`PartialPromoteError`）
     * 也一并删掉——两套错误处理并存，迟早有人照着已经不可能发生的那套写前端文案。
     *
     * 上面那道「与目标集既有用例归一化精确比对」照旧保留：它防的是**重复点按/重试**造整批重复，
     * 与原子性是两回事，原子化并不使它多余。
     */
    const created = await this.db.transaction(async (tx) => {
      const cases = await this.evalSets.createCasesBatchTx(
        tx,
        req.targetSetId,
        // 显式挑字段，**不要** `{ ...entry }`：itemId/force 是服务端内部状态，
        // `eval_cases` 没有这两列，spread 会把它们一路带到插入语句里。
        kept.map((entry) => ({
          question: entry.question,
          goldPoints: entry.goldPoints,
          ...(entry.sourceTraceId === undefined ? {} : { sourceTraceId: entry.sourceTraceId }),
          goldDocRefs: [],
          tags: [],
        })),
      );
      // 「已进评测集」与用例同生共死：回滚掉用例却留下标志，会让一个其实没入集的簇看起来已完事。
      await this.repo.markEnteredEvalSetTx(tx, req.clusterId, now);
      return cases;
    });
    return {
      created: created.length,
      caseIds: created.map((c) => c.id),
      // 两个字段都**只在有内容时**出现，省得调用方每次都要区分「空数组」与「没这回事」。
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(truncated ? { duplicateCheckTruncated: truncated } : {}),
    };
  }

  /**
   * 语义近似重复检测（原型 `:269`「入集时 embedding 相似度 >0.95 提示『疑似重复，与用例 #12
   * 相似』，可强制加入」）。**追加**在精确比对之后，不替代它。
   *
   * 三条设计要点：
   *  · **不是硬拒绝**。带 `force: true` 的条目整个跳过本检查——近似判定必然有假阳性，
   *    没有强制回路的重复检测会把用户堵死在一条他明知不重复的用例上，比不做更糟。
   *  · **严格大于阈值**才算重复（恰好 0.95 放行），与 `FOLLOWUP_RATIO_MIN` 同款口径。
   *  · **比对量封顶**在 `DUPLICATE_COMPARE_CASE_LIMIT`，并把截断回给调用方。
   *
   * 没配 embedding 模型时**跳过**而不是报错：promote 本身不依赖 embedding，
   * 因为一个在线评测的设置项没填就让人连用例都入不了集，是把可选的增强做成了硬依赖。
   * 但 embed **调用失败**照旧向上抛——那是意外故障，吞掉它等于让检测无声失效。
   */
  private async detectSemanticDuplicates(
    plan: PlanEntry[],
    existingCases: ExistingCase[],
  ): Promise<{
    kept: PlanEntry[];
    warnings: PromoteGapWarning[];
    truncated?: { comparedCases: number; totalCases: number };
  }> {
    const none = { kept: plan, warnings: [] as PromoteGapWarning[] };

    // 索引一并留着：warning 要挂回**具体那一条** plan 条目，而 itemId 理论上可以重复
    // （同一个 itemId 传两次、question 各自覆写成不同文本时，精确层不会去重）。
    const candidates = plan.map((entry, index) => ({ entry, index })).filter((c) => !c.entry.force);
    const compared = existingCases.slice(0, DUPLICATE_COMPARE_CASE_LIMIT);
    // 目标集为空（新建的集）或整批都 force ⇒ 一次网络往返都不发。
    if (compared.length === 0 || candidates.length === 0) return none;

    const { embeddingModelId } = await this.evaluations.getSettings();
    if (!embeddingModelId) return none;

    // 候选与既有用例**拼成一次调用**：分两次发就是两次往返，而它们本来就要用同一个模型
    // 才可比（不同模型的向量空间之间算余弦没有意义）。顺序即入参顺序，下面按 offset 切开。
    const vectors = await this.models.embedTexts(embeddingModelId, [
      ...candidates.map((c) => c.entry.question),
      ...compared.map((c) => c.question),
    ]);
    const expected = candidates.length + compared.length;
    if (vectors.length !== expected) {
      // 数量对不上就没法按位置对齐，再往下算只会把 A 的向量当成 B 的、给出**指向错误用例**的
      // 「疑似重复」提示。宁可炸也不能产出错误的对齐结果（同 gap-clustering 的 assertSameDim）。
      throw new Error(
        `embedding 返回数量与入参不符（期望 ${expected}，实际 ${vectors.length}）——无法按位置对齐`,
      );
    }
    const candidateVectors = vectors.slice(0, candidates.length);
    const caseVectors = vectors.slice(candidates.length);

    const warnings: PromoteGapWarning[] = [];
    const blocked = new Set<number>();
    for (let i = 0; i < candidates.length; i++) {
      let best: PromoteGapWarning["similarTo"] | null = null;
      let bestSim = -1;
      for (let j = 0; j < compared.length; j++) {
        const sim = cosineSimilarity(candidateVectors[i], caseVectors[j]);
        if (sim > bestSim) {
          bestSim = sim;
          best = { caseId: compared[j].id, question: compared[j].question };
        }
      }
      // 严格大于：恰好等于阈值不触发。
      if (best && bestSim > DUPLICATE_SIMILARITY_MIN) {
        blocked.add(candidates[i].index);
        warnings.push({ itemId: candidates[i].entry.itemId, similarTo: best, similarity: bestSim });
      }
    }

    return {
      kept: plan.filter((_, index) => !blocked.has(index)),
      warnings,
      // 只有**真比对过**才谈得上截断：上面提前返回的几条路径一条都没比，说「只比了前 200 条」
      // 会把「压根没查」粉饰成「查了但没查全」。
      ...(existingCases.length > compared.length
        ? { truncated: { comparedCases: compared.length, totalCases: existingCases.length } }
        : {}),
    };
  }

  /**
   * 决策 G 的服务端守卫。调用方传了 question 就用它（那是人在 Modal 里手改的）；
   * 否则只接受**改写已消解**的 item。
   *
   * 为什么必须拦：离线评测没有对话上下文，「还有上面说的那点呢」这种指代原文无论检索多准
   * 都答不对——放进去就是一条**永久 0 分**的用例，它会把整个评测集的分数往下压，
   * 而且看起来像是系统的问题。
   */
  private resolveQuestion(override: string | undefined, row: GapItemRow): string {
    const manual = override?.trim();
    if (manual) return manual;
    // resolved 但没有改写文本 = 首轮问题（本来就独立），原文可用。
    if (row.rewriteResolved) return (row.rewrittenQuestion ?? row.question).trim();
    throw new BadRequestException(
      `「${row.question}」指代未消解，不能直接入集：离线评测无对话上下文，指代原文永远答不对，会成为永久 0 分用例——请先改写成可独立检索的问题`,
    );
  }

  /** 与 `GapsService.assertItemsBelongTo` 同款：不校验就能靠一次 promote 把别簇的成员沉淀走。 */
  private async assertItemsBelongTo(clusterId: string, itemIds: string[]): Promise<GapItemRow[]> {
    const rows = await this.repo.listItemsByIds(itemIds);
    if (rows.length !== new Set(itemIds).size) {
      throw new BadRequestException("部分 item 不存在");
    }
    const foreign = rows.filter((row) => row.clusterId !== clusterId);
    if (foreign.length > 0) {
      throw new BadRequestException(
        `以下 item 不属于本缺口，不能入集：${foreign.map((f) => f.id).join(", ")}`,
      );
    }
    return rows;
  }
}
