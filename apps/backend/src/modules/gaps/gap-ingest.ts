import { CLUSTER_SIMILARITY_MIN } from "./gap.constants";
import { cosineSimilarity, updateCentroid } from "./gap-clustering";
import { triageCluster, triageItem } from "./gap-triage";
import type {
  AttachItemResult,
  GapClusterTarget,
  GapCollectorStore,
  GapItemDraft,
} from "./gaps.repository";

/**
 * 入池的两个共享动作：**归簇** 与 **重算簇根因**。
 *
 * 两个调用方——收集器 worker（自动，批量）与 `GapsService.addItem`（人从 Trace 详情手动挑一条）
 * ——必须用**同一套**判定：若各写一份，「手动加的样本会不会和自动收的归到同一个簇」就变成
 * 两份实现的巧合，而原型 `:648`「已在缺口『…』(×N) 中」正依赖它们口径一致。
 *
 * 抽成纯函数而不是 Nest service：它没有自己的状态，只是把 store 与三个纯函数编排起来。
 */

/**
 * 最近邻归簇：相似度 ≥ 阈值并入既有簇（质心增量平均），否则建新簇。
 *
 * pgvector 只用来**找**候选，相似度由 `cosineSimilarity` 重算 —— 判定只有一处实现，
 * 且是被表驱动单测覆盖的那处（详见 `gaps.repository.ts:findNearestCluster` 的注释）。
 */
export async function assignToCluster(
  store: GapCollectorStore,
  clusterKey: string,
  draft: GapItemDraft,
  now: Date,
): Promise<AttachItemResult> {
  const nearest = await store.findNearestCluster(draft.embedding);
  const similarity = nearest ? cosineSimilarity(nearest.centroid, draft.embedding) : 0;
  const target: GapClusterTarget =
    nearest && similarity >= CLUSTER_SIMILARITY_MIN
      ? {
          kind: "existing",
          clusterId: nearest.id,
          nextCentroid: updateCentroid(nearest.centroid, nearest.freq, draft.embedding),
        }
      : { kind: "new", representativeQuestion: clusterKey, centroid: draft.embedding };
  return store.attachItem(target, draft, now);
}

/**
 * 按簇现有全部成员重算 `root_cause_auto`。
 *
 * **只写 auto 列**——人工判定（`root_cause_manual`）永不被覆盖（Global Constraint 8），
 * 读取一律 `COALESCE(manual, auto)`。
 *
 * `followUpRatio` 的分母**只算 `online`**（与读模型 `listClusters` 逐字一致，但**故意不同于**
 * `freq_30d` 的 `<> 'offline_run'`）：`follow_up_suspected` 只可能由收集器对 online 样本置真——
 * 手动入池的行恒为 false（拿不到 `contextPrecision`，也没有改写数据）。把恒不可能进分子的行
 * 放进分母只会**稀释**：3/3 的指代追问簇，人再手动补 4 条同题样本就成 3/7 = 0.43，
 * `triageCluster` 的强制 `retrieval` 覆写随即失效、根因翻回 `missing`
 * ⇒ 021 §6.4 要防的「把人力引去补一篇根本不缺的文档」恰好发生。**补证据反而让诊断变坏。**
 */
export async function recomputeRootCause(
  store: GapCollectorStore,
  clusterId: string,
  now: Date,
): Promise<void> {
  const inputs = await store.listClusterTriageInputs(clusterId);
  if (inputs.length === 0) return;
  const causes = inputs.map((i) =>
    triageItem({
      confidence: i.confidence,
      contextPrecision: i.contextPrecision,
      faithfulness: i.faithfulness,
    }),
  );
  const counted = inputs.filter((i) => i.source === "online");
  const followUpRatio =
    counted.length === 0
      ? 0
      : counted.filter((i) => i.followUpSuspected).length / counted.length;
  await store.setClusterRootCauseAuto(clusterId, triageCluster(causes, followUpRatio), now);
}
