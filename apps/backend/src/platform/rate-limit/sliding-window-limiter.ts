/**
 * 进程内「同一个键 N 毫秒只受理一次」的限频器。
 *
 * **为什么抽出来**：仓库里原本有**两份**逐字同构的实现——`ReplayService`（按 sourceTraceId）
 * 与 `EvaluationsService`（按 targetTraceId），连 429 文案「操作过于频繁，请 1 分钟后再试」
 * 都一样。B2b 给前者加了过期键清理，后者**没跟上**，于是同一个 bug 修了一半：
 * evaluations 那张表至今只增不减（清理复审指出）。一份实现就不会再漂。
 *
 * **为什么把「查」和「记」分开**，而不是一个 `hit(key)` 了事：两个调用点的语义不同——
 * `EvaluationsService` 有一条「上次判分失败 ⇒ 放行重试」的旁路，那条路径**跳过检查但仍要记时间**。
 * 合成一个方法的话，这个差异只能靠传 flag 表达，读代码的人得跳进实现才知道 flag 什么意思。
 *
 * ⚠️ **单副本前提**（019 Boundary 5）。进程内 Map 拦不住多副本部署；
 * 真要多副本得换 Redis，届时换掉本类的实现即可，两个调用点不用动。
 */
export class SlidingWindowLimiter {
  private readonly lastAt = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  /** 该键是否仍在窗口内（`true` = 应当拒绝）。**只读，不写入。** */
  isLimited(key: string, now: number): boolean {
    const last = this.lastAt.get(key);
    return last !== undefined && now - last < this.windowMs;
  }

  /**
   * 记一次受理，并顺手清掉所有已过窗口的键。
   *
   * 清理不是「顺手做的卫生」而是必需：调用方可能用**一次性**的键
   * （如自动回验每次合成一个新的 trace id 绕开限频），那些键保证不会被第二次读到，
   * 不清的话一个长期运行的进程里这张表只增不减。
   */
  record(key: string, now: number): void {
    for (const [k, at] of this.lastAt) {
      if (now - at >= this.windowMs) this.lastAt.delete(k);
    }
    this.lastAt.set(key, now);
  }

  /** 测试用：当前保留的键数。生产代码不该依赖它。 */
  get size(): number {
    return this.lastAt.size;
  }

  /**
   * 测试用：清空全部配额。
   *
   * 限频是进程内状态，e2e 里跨用例不清的话第二条起全是 429。
   * 之前 `manual-score.e2e.spec.ts` 是**强转成私有字段**去 `.clear()` 的
   * （`(service as unknown as { lastManualScoreAt: Map<…> }).lastManualScoreAt.clear()`），
   * 于是本次把那个字段换成限频器实例时，10 条 e2e 一起炸在 `Cannot read properties of undefined`。
   * 给一个明确的测试出口，比让测试去猜实现细节强。
   */
  reset(): void {
    this.lastAt.clear();
  }
}
