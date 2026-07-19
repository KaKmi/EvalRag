import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type {
  DraftGoldRequest,
  DraftGoldResponse,
  PromoteGapRequest,
  PromoteGapResponse,
} from "@codecrush/contracts";
import { EvaluationsRepository } from "../evaluations/evaluations.repository";
import { parseJudgeOutput, structuredOutput } from "../evaluations/evaluation-judge.utils";
import { EvalSetsService } from "../eval-runs/eval-sets.service";
import { ModelsService } from "../models/models.service";
import { normalizeQuestion } from "./gap-triage";
import { GapsRepository } from "./gaps.repository";
import type { GapItemRow } from "./schema";

/**
 * 半批失败：**已经建成的用例 id 必须随错误一起交出去**。
 *
 * 只抛一个笼统的 500，用户会以为一条都没进 ⇒ 重试 ⇒ 若哪天跨集去重被人删掉，
 * 就是整批重复。带上 `caseIds` 让前端能如实说「已加入 N 条，其余失败」。
 */
export class PartialPromoteError extends Error {
  constructor(
    readonly caseIds: string[],
    readonly cause: unknown,
  ) {
    super(
      `已加入 ${caseIds.length} 条后失败：${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "PartialPromoteError";
  }
}

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

@Injectable()
export class GapPromoteService {
  constructor(
    private readonly repo: GapsRepository,
    private readonly evaluations: EvaluationsRepository,
    private readonly models: ModelsService,
    private readonly evalSets: EvalSetsService,
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
    actor: string,
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
     * ⚠️ **重复检测在本波是降级实现**（B2a），但降级的**只有语义近似那一半**：
     *  · **做了**：本批内部去重 **+ 与目标集既有用例按归一化问题精确比对**（下面这次 listCases）。
     *    后者是 peer review 要求补的——`markEnteredEvalSet` 是幂等的「只写一次」语义，
     *    簇上有了紫标**照样能再点一次 [进评测集]**，没有这道比对，重试或误点会让同一批问题
     *    原样再落一遍，目标集里出现整批重复的 draft 用例，人审时根本看不出哪条是重复。
     *    它同时把「promote 中途失败后重试」变成安全操作（见下方插入循环的注释）。
     *  · **没做**：embedding 相似度 >0.95 的「疑似重复，与用例 #12 相似」标记 + 强制加入
     *    （原型 `:269`）⇒ 留 B2b。理由：跨集比对要把目标集全部用例 embed 一遍，
     *    成本随集大小线性增长；且没有「强制加入」的交互回路，它会退化成硬拒绝——比不做更糟。
     */
    const existing = new Set(
      (await this.evalSets.listCases(req.targetSetId)).map((item) =>
        normalizeQuestion(item.question),
      ),
    );
    const seen = new Set<string>();
    const plan: { question: string; goldPoints: string[]; sourceTraceId?: string }[] = [];

    // **先全量解析、再落库**：决策 G 的守卫会抛 400，若边解析边写就会留下「前 3 条进了、
    // 第 4 条 400」的半批状态——用户看到失败，却已经有用例躺在目标集里。
    for (const item of req.items) {
      const row = byId.get(item.itemId)!;
      const question = this.resolveQuestion(item.question, row);
      const key = normalizeQuestion(question);
      if (seen.has(key) || existing.has(key)) continue;
      seen.add(key);
      plan.push({
        question,
        // 空白要点会满足「reviewed 需 ≥1 条」却无从判起（同 CreateEvalCaseRequestSchema 的口径）。
        goldPoints: item.goldPoints.map((point) => point.trim()).filter(Boolean),
        ...(TRACE_ID.test(row.sourceTraceId) ? { sourceTraceId: row.sourceTraceId } : {}),
      });
    }

    /**
     * 插入是**逐条**的，不在一个事务里——`EvalSetsService.createCase` 不接受外部 tx，
     * 而为了本端点去改 eval-runs 的仓库签名，代价大于收益。
     *
     * 因此中途失败会留下**部分已入集**的状态。这一点靠两件事把危害压掉：
     *  ① 上面那道「与目标集既有用例精确比对」让**重试是安全的**——已进去的那几条会被跳过，
     *     不会因为重试而出现整批重复；
     *  ② 失败时把**已经建成的 caseIds 一并抛给调用方**，前端据此如实提示「已加入 N 条，其余失败」，
     *     而不是笼统报错让用户以为一条都没进（那才会诱发危险的重试）。
     * 真正的原子批量留 B2b 与「补知识库」一起做——那时 eval-runs 侧本来就要开事务接口。
     */
    const caseIds: string[] = [];
    try {
      for (const entry of plan) {
        const created = await this.evalSets.createCase(
          req.targetSetId,
          { ...entry, goldDocRefs: [], tags: [] },
          actor,
        );
        caseIds.push(created.id);
      }
    } catch (error) {
      throw new PartialPromoteError(caseIds, error);
    }

    // 全部落库成功才打「已进评测集」标志——半批时不打，免得一个没进全的簇看起来已经完事。
    await this.repo.markEnteredEvalSet(req.clusterId, now);
    return { created: caseIds.length, caseIds };
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
