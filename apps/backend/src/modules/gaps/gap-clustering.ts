/**
 * 缺口聚类的纯向量运算（021 §10 / 决策 C）。
 *
 * 单独成文件、零依赖：收集器 worker 是唯一调用方，但这些函数的正确性（尤其零向量与
 * 增量质心和批量均值的一致性）值得表驱动单测独立覆盖，不该埋在 service 里靠集成测试撞。
 */

/**
 * 余弦相似度。零向量/空向量/维度不一致一律返回 0 —— 返回 NaN 会让上游
 * `sim >= CLUSTER_SIMILARITY_MIN` 静默判 false 而不报错，等于把脏数据伪装成「不相似」；
 * 显式取 0 语义相同但可解释（"没有可比信息" ⇒ 不归簇 ⇒ 建新簇）。
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  // 非有限值（入参含 NaN/Infinity）同样归 0。零向量守卫 `na === 0` 对 NaN 无效
  // （`NaN === 0` 为 false），少了这一行，上面注释承诺的「绝不返回 NaN」就是假的。
  return Number.isFinite(sim) ? sim : 0;
}

/**
 * 增量更新簇质心：`(centroid * freq + v) / (freq + 1)`。
 *
 * 用增量而非「取回全部成员向量重算」，是因为收集器每次只处理增量 trace，簇成员向量并不
 * 全在手上（ClickHouse 里存的是 item，重拉一簇的全部 embedding 代价随簇规模线性增长）。
 * `freq` 必须是**并入本向量之前**的成员数，否则权重会偏。返回新数组，不改入参。
 */
export function updateCentroid(centroid: number[], freq: number, v: number[]): number[] {
  if (freq <= 0) return [...v];
  assertSameDim(centroid.length, v.length, "updateCentroid");
  return centroid.map((c, i) => (c * freq + v[i]) / (freq + 1));
}

/**
 * 批量均值。簇被人工拆分后成员集合整体变了，增量式无法回退，只能拿剩余成员重算。
 * 与 `updateCentroid` 逐个并入的结果在浮点误差内一致（有测试守着这条不变量）。
 */
export function meanVector(vs: number[][]): number[] {
  if (vs.length === 0) return [];
  const dim = vs[0].length;
  for (const v of vs) assertSameDim(dim, v.length, "meanVector");
  const out = new Array<number>(dim).fill(0);
  for (const v of vs) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  return out.map((s) => s / vs.length);
}

/**
 * 质心写入的乐观并发校验失败（B2b：021 §12② 的收口）。
 *
 * **它是什么**：`assignToCluster` 读最近邻拿到 `(centroid, freq)`，据此算出 `nextCentroid`
 * （增量平均 `(c*f+v)/(f+1)`），随后 repository 的 UPDATE 带 `WHERE freq = 观察到的 freq`。
 * 若期间另一个实例已经并入过别的样本，`freq` 已经变了 ⇒ 影响 0 行 ⇒ 抛本错误。
 *
 * **为什么必须重算而不是简单重试写入**：`nextCentroid` 是用**旧的** centroid 与 freq 算出来的，
 * 此刻已经过期——直接重写会把对方那次并入的贡献覆盖掉，正是要防的那个丢失更新。
 * 调用方必须重新走一遍 `findNearestCluster` + 相似度判定（最近簇甚至可能已经换了一个）。
 *
 * **危害等级**：丢的是质心精度（聚类质量退化），不是丢数据——`freq` 用 `freq + 1` 自增本身是原子的。
 * 触发条件也窄：要两个实例在租约超时窗口内并发处理同一个簇。故重试有限次即可，不必无限重试。
 *
 * 定义在本文件而非 repository：它是「质心该不该这样写」这件事的领域词汇，与同文件
 * `assertSameDim`「探测到不安全的质心写入就抛，绝不产出脏 centroid」是同一条原则。
 * 真正执行比较的是 SQL 的 WHERE，repository 只负责把「0 行」翻译成这个错误。
 */
export class GapCentroidStaleError extends Error {
  constructor(readonly clusterId: string) {
    super(`gap cluster ${clusterId} centroid was concurrently modified, retry required`);
    this.name = "GapCentroidStaleError";
  }
}

/**
 * 维度不一致时**抛错**，不静默产出 NaN 或截断向量（peer review 抓出的洞）。
 *
 * 为什么这两个函数抛、而 `cosineSimilarity` 取 0：`cosineSimilarity` 只影响一次**瞬时比较**，
 * 取 0（"没有可比信息" ⇒ 不归簇）语义自洽；而这两个函数产出的是**要落库的 centroid**。
 * 让脏值流下去的后果不可接受：
 *   `meanVector([[1,2],[3]])` → `[2, NaN]`；NaN 通不过 `cosineSimilarity` 的零向量守卫
 *   （`NaN === 0` 为 false），于是每次比较都返回 NaN、`sim >= 阈值` 恒 false
 *   ⇒ 每条样本都建新簇 ⇒ 簇数无界增长，且**全程不报错**。
 * 维度不一致只可能来自 embedding 模型配置错误，属编程/配置错误而非数据情形，就该当场炸。
 */
function assertSameDim(expected: number, actual: number, fn: string): void {
  if (expected !== actual) {
    throw new Error(
      `${fn}: 向量维度不一致（期望 ${expected}，实际 ${actual}）——` +
        `多半是 embedding 模型配置变了；此处宁可炸也不能产出 NaN/截断的 centroid 落库`,
    );
  }
}
