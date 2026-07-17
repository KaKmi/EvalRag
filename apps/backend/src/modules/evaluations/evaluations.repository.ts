import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { DRIZZLE } from "../../platform/persistence/drizzle.constants";
import type { DB } from "../../platform/persistence/persistence.module";
import {
  evalWatermarks,
  onlineEvalSettings,
  type EvalWatermarkRow,
  type OnlineEvalSettingsRow,
} from "./schema";

export type OnlineEvalSettingsUpdate = Partial<Omit<OnlineEvalSettingsRow, "id" | "updatedAt">>;

export interface FinishEvaluationCycle {
  lastTs: Date;
  lastTraceId: string;
  evaluatedIncrement: number;
  now: Date;
  /**
   * 裁判健康状态。**`undefined` = 本轮没动过裁判 ⇒ 不改写这两列**（保住上一次真实故障）；
   * 传值 = 本轮确实调过裁判，该值就是权威。
   * 曾经这两列被无条件写成 `?? 0` / `?? null`，而空轮也走 finishCycle ⇒ 任何一个无所事事的
   * 轮次都会把「上次为什么失败」擦干净（018 §12 缺口 20 的排除论证 ③ 正因此失效）。
   */
  consecutiveFailures?: number;
  lastError?: string | null;
}

function utcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

@Injectable()
export class EvaluationsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DB) {}

  async getSettings(): Promise<OnlineEvalSettingsRow> {
    await this.db.insert(onlineEvalSettings).values({ id: "default" }).onConflictDoNothing();
    const [settings] = await this.db
      .select()
      .from(onlineEvalSettings)
      .where(eq(onlineEvalSettings.id, "default"))
      .limit(1);
    if (!settings) throw new Error("online evaluation settings unavailable");
    return settings;
  }

  async updateSettings(
    update: OnlineEvalSettingsUpdate,
    now = new Date(),
  ): Promise<OnlineEvalSettingsRow> {
    await this.getSettings();
    const [settings] = await this.db
      .update(onlineEvalSettings)
      .set({ ...update, updatedAt: now })
      .where(eq(onlineEvalSettings.id, "default"))
      .returning();
    if (!settings) throw new Error("online evaluation settings unavailable");
    return settings;
  }

  /**
   * 只读取水位线，不存在也不创建——读路径（屏1 总览）专用。
   * getOrCreateWatermark 会把游标播种在 now-24h，那是**破坏性**的：此后所有更早的 trace
   * 永久出不了候选集。它只该由真正要推进游标的 worker 调用；一个 GET 绝不能有这种副作用
   * （曾经有：打开屏1 即钉死游标，尤其在只起 api 没起 worker 时）。
   */
  async findWatermark(workerName: string): Promise<EvalWatermarkRow | undefined> {
    const [watermark] = await this.db
      .select()
      .from(evalWatermarks)
      .where(eq(evalWatermarks.workerName, workerName))
      .limit(1);
    return watermark;
  }

  /**
   * `seedFrom` 只在**行不存在**时决定游标起点——`onConflictDoNothing` 保护重启（保住原游标），
   * 但保护不了诞生：那一刻起，早于 seedFrom 的 trace 永不进候选集（`listCandidates` 只往前看）。
   * 默认 `now - 24h` = `017:26` 的原行为；调用方（worker）按 `ONLINE_EVAL_BACKFILL_WINDOW_HOURS`
   * 覆盖。默认值留在这里是为了让「不传 = 原行为」，既有调用点与测试无需改动。
   */
  async getOrCreateWatermark(
    workerName: string,
    now: Date,
    seedFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000),
  ): Promise<EvalWatermarkRow> {
    const today = utcDate(now);
    await this.db
      .insert(evalWatermarks)
      .values({
        workerName,
        lastTs: seedFrom,
        lastTraceId: "",
        dailyDate: today,
      })
      .onConflictDoNothing();
    await this.db
      .update(evalWatermarks)
      .set({ dailyDate: today, dailyCount: 0, updatedAt: now })
      .where(
        and(
          eq(evalWatermarks.workerName, workerName),
          sql`${evalWatermarks.dailyDate} <> ${today}`,
        ),
      );
    const [watermark] = await this.db
      .select()
      .from(evalWatermarks)
      .where(eq(evalWatermarks.workerName, workerName))
      .limit(1);
    if (!watermark) throw new Error(`evaluation watermark unavailable: ${workerName}`);
    return watermark;
  }

  /**
   * 水位线的行就是在这里诞生的——**worker 真正开工的那一刻**，也是唯一该播种的时机。
   * 故 `seedFrom` 必须一路透传到这里；只传给 `getOrCreateWatermark` 是够不着的。
   */
  async tryAcquireLease(
    workerName: string,
    owner: string,
    now: Date,
    ttlMs: number,
    seedFrom?: Date,
  ): Promise<boolean> {
    await this.getOrCreateWatermark(workerName, now, seedFrom);
    const rows = await this.db
      .update(evalWatermarks)
      .set({
        leaseOwner: owner,
        leaseUntil: new Date(now.getTime() + ttlMs),
        lastRunAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(evalWatermarks.workerName, workerName),
          or(
            isNull(evalWatermarks.leaseUntil),
            lt(evalWatermarks.leaseUntil, now),
            eq(evalWatermarks.leaseOwner, owner),
          ),
        ),
      )
      .returning({ workerName: evalWatermarks.workerName });
    return rows.length === 1;
  }

  async finishCycle(
    workerName: string,
    owner: string,
    result: FinishEvaluationCycle,
  ): Promise<void> {
    const today = utcDate(result.now);
    await this.db
      .update(evalWatermarks)
      .set({
        lastTs: result.lastTs,
        lastTraceId: result.lastTraceId,
        dailyDate: today,
        dailyCount: sql`CASE
          WHEN ${evalWatermarks.dailyDate} = ${today}
            THEN ${evalWatermarks.dailyCount} + ${result.evaluatedIncrement}
          ELSE ${result.evaluatedIncrement}
        END`,
        leaseOwner: null,
        leaseUntil: null,
        lastRunAt: result.now,
        lastSuccessAt: result.now,
        // 没动过裁判就不碰这两列——见 FinishEvaluationCycle 的注释。
        ...(result.consecutiveFailures === undefined
          ? {}
          : { consecutiveFailures: result.consecutiveFailures }),
        ...(result.lastError === undefined ? {} : { lastError: result.lastError }),
        updatedAt: result.now,
      })
      .where(and(eq(evalWatermarks.workerName, workerName), eq(evalWatermarks.leaseOwner, owner)));
  }

  async releaseLease(workerName: string, owner: string, now = new Date()): Promise<void> {
    await this.db
      .update(evalWatermarks)
      .set({ leaseOwner: null, leaseUntil: null, updatedAt: now })
      .where(and(eq(evalWatermarks.workerName, workerName), eq(evalWatermarks.leaseOwner, owner)));
  }

  /**
   * 行不存在时**不创建**——一个失败的轮次不该顺手把游标播种下去。原先它调 getOrCreateWatermark，
   * 于是「模型还没配好就跑了一轮」会以 `now-24h` 建行，把更早的历史永久排除出候选集，
   * 而这个播种时刻与任何人的意图都无关。行不存在 = worker 没真正开工过，
   * 屏1 已由 `worker_stalled`（无行/lastRunAt 陈旧）与 `model_unavailable`（独立查模型）如实表达，
   * 不需要靠这行记账。
   */
  async recordFailure(workerName: string, errorClass: string, message: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(evalWatermarks)
      .set({
        lastRunAt: now,
        consecutiveFailures: sql`${evalWatermarks.consecutiveFailures} + 1`,
        lastError: `${errorClass}: ${message}`.slice(0, 200),
        updatedAt: now,
      })
      .where(eq(evalWatermarks.workerName, workerName));
  }
}
