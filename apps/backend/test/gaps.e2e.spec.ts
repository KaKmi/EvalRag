import { randomUUID } from "node:crypto";
import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { APP_GUARD, APP_PIPE } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import { ZodValidationPipe } from "nestjs-zod";
import request from "supertest";
import { applyGlobalConfig } from "../src/app/app-bootstrap";
import { GapsController } from "../src/modules/gaps/gaps.controller";
import { GapsRepository } from "../src/modules/gaps/gaps.repository";
import { GapsService } from "../src/modules/gaps/gaps.service";
import { createEvaluationInfraHarness, E2E_EMBED_MODEL_ID } from "./helpers/evaluation-infra";
import { infraGate } from "./helpers/gated-suite";

/**
 * 屏5 问题池的 **HTTP 全链路**守护网：controller → Zod → service → 真仓库 → 真 PG。
 *
 * 与 `test/gaps.service.db.spec.ts` 的分工：那边守**领域语义**（状态机迁移表、拆分守恒、
 * freq30d 谓词、avgQuality 的 NULL 处理）；本文件只守**HTTP 边界**——路由挂没挂上、
 * Zod 400 有没有生效、路径参数非 UUID 会不会漏成 500、写操作的响应形状对不对。
 * 两边刻意不重复：领域断言堆在 e2e 里跑得慢且定位差。
 *
 * ⛔ 只连 MIGRATION_TEST_DATABASE_URL（codecrush_mig_test）——`resetAndMigrate` 会 DROP SCHEMA。
 */

const describeInfra = infraGate();
jest.setTimeout(180_000);

const ACTOR = "e2e-gaps@codecrush.dev";
const hex32 = () => randomUUID().replaceAll("-", "");

describeInfra("B2a 屏5 问题池（HTTP e2e，真 PG）", () => {
  let app: INestApplication;
  let harness: Awaited<ReturnType<typeof createEvaluationInfraHarness>>;
  let repo: GapsRepository;
  let embedVector: number[];

  beforeAll(async () => {
    harness = await createEvaluationInfraHarness();
    await harness.resetAndMigrate();
    const db = drizzle(harness.pool) as never;
    repo = new GapsRepository(db);

    const evaluations = {
      getSettings: async () => ({ embeddingModelId: E2E_EMBED_MODEL_ID, judgeVersion: "online-v1" }),
    };
    const models = {
      embedTexts: async (_id: string, texts: string[]) => texts.map(() => embedVector),
    };
    const service = new GapsService(repo, evaluations as never, models as never);

    const ref = await Test.createTestingModule({
      controllers: [GapsController],
      providers: [
        { provide: GapsService, useValue: service },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (ctx: ExecutionContext) => {
              ctx.switchToHttp().getRequest().user = { id: "u-e2e", email: ACTOR };
              return true;
            },
          },
        },
      ],
    }).compile();
    app = ref.createNestApplication();
    applyGlobalConfig(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await harness.close();
  });

  beforeEach(() => {
    embedVector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
  });

  afterEach(async () => {
    // 按本套件自己造的行清理：问题池表在本套件开头已 DROP SCHEMA 重建，
    // 这里只是让用例之间互不干扰（最近邻会跨用例把新样本归进上一个用例的簇）。
    await harness.pool.query("DELETE FROM gap_items");
    await harness.pool.query("DELETE FROM gap_clusters");
  });

  /** 走公开端点造一个簇——e2e 里不直接写 SQL，免得绕过被测的那条路径。 */
  async function createCluster(question: string, traceId = hex32()): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/api/gaps/items")
      .send({ question, source: "manual_trace", sourceTraceId: traceId })
      .expect(201);
    return res.body.clusterId as string;
  }

  it("GET /gaps 返回契约形状（含查询期聚合的 freq30d / avgQuality）", async () => {
    await createCluster("能开专用发票吗");

    const res = await request(app.getHttpServer()).get("/api/gaps").expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      representativeQuestion: "能开专用发票吗",
      freq: 1,
      status: "pending",
      rootCauseIsManual: false,
    });
    // 手动入池没有 trace_start_time ⇒ 不进 30 天窗口；没有分数 ⇒ avgQuality 是 null 不是 0。
    expect(res.body.items[0].freq30d).toBe(0);
    expect(res.body.items[0].avgQuality).toBeNull();
  });

  it("GET /gaps/summary 返回四个计数", async () => {
    const id = await createCluster("退款要多久");
    await request(app.getHttpServer()).post(`/api/gaps/${id}/ignore`).expect(201);

    const res = await request(app.getHttpServer()).get("/api/gaps/summary").expect(200);
    expect(res.body).toEqual({ pending: 0, routedRetrieval: 0, ignored: 1, enteredEvalSet: 0 });
  });

  it("GET /gaps/:id/items 返回簇内成员", async () => {
    const traceId = hex32();
    const id = await createCluster("能开专用发票吗", traceId);

    const res = await request(app.getHttpServer()).get(`/api/gaps/${id}/items`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ sourceTraceId: traceId, source: "manual_trace" });
  });

  it("POST /gaps/items 重复入同一条 trace ⇒ joinedExisting=true，不再插一行", async () => {
    const traceId = hex32();
    await createCluster("能开专用发票吗", traceId);

    const res = await request(app.getHttpServer())
      .post("/api/gaps/items")
      .send({ question: "能开专用发票吗", source: "manual_trace", sourceTraceId: traceId })
      .expect(201);

    expect(res.body.joinedExisting).toBe(true);
    expect(res.body.freq).toBe(1);
  });

  it("状态迁移端点走通，非法迁移 400", async () => {
    const id = await createCluster("能开专用发票吗");

    await request(app.getHttpServer()).post(`/api/gaps/${id}/route-retrieval`).expect(201);
    // pending 才能 route-retrieval，已是 routed_retrieval ⇒ 第二次非法
    await request(app.getHttpServer()).post(`/api/gaps/${id}/route-retrieval`).expect(400);
    // 但 ignore 合法（V15：没有出口的状态是死态）
    const ignored = await request(app.getHttpServer()).post(`/api/gaps/${id}/ignore`).expect(201);
    expect(ignored.body.status).toBe("ignored");
  });

  it("PATCH /gaps/:id/root-cause 写人工判定并在响应里生效", async () => {
    const id = await createCluster("能开专用发票吗");

    const res = await request(app.getHttpServer())
      .patch(`/api/gaps/${id}/root-cause`)
      .send({ rootCause: "generation" })
      .expect(200);

    expect(res.body.rootCause).toBe("generation");
    expect(res.body.rootCauseIsManual).toBe(true);
  });

  it("Zod 拦下坏 body：枚举外的 rootCause / 空 itemIds / 缺字段一律 400", async () => {
    const id = await createCluster("能开专用发票吗");

    await request(app.getHttpServer())
      .patch(`/api/gaps/${id}/root-cause`)
      .send({ rootCause: "not-a-cause" })
      .expect(400);
    await request(app.getHttpServer()).post(`/api/gaps/${id}/split`).send({ itemIds: [] }).expect(400);
    await request(app.getHttpServer())
      .post("/api/gaps/items")
      .send({ question: "", source: "manual_trace", sourceTraceId: "t" })
      .expect(400);
    await request(app.getHttpServer())
      .post("/api/gaps/items")
      .send({ question: "q", source: "online", sourceTraceId: "t" }) // online 不在手动入池的枚举里
      .expect(400);
  });

  it("非 UUID 的路径参数是 400 而不是 500（不让它一路走到 SQL）", async () => {
    await request(app.getHttpServer()).get("/api/gaps/not-a-uuid/items").expect(400);
    await request(app.getHttpServer()).post("/api/gaps/not-a-uuid/ignore").expect(400);
  });

  it("不存在的簇是 404", async () => {
    await request(app.getHttpServer()).post(`/api/gaps/${randomUUID()}/ignore`).expect(404);
  });

  it("POST /gaps/:id/merge 把成员并进目标簇并软删空掉的源簇", async () => {
    const source = await createCluster("能开专用发票吗");
    // 换一个正交向量，保证第二条不会被最近邻并进同一个簇。
    embedVector = Array.from({ length: 1024 }, (_, i) => (i === 1 ? 1 : 0));
    const target = await createCluster("怎么申请退款");
    expect(target).not.toBe(source);

    const items = await request(app.getHttpServer()).get(`/api/gaps/${source}/items`).expect(200);
    const res = await request(app.getHttpServer())
      .post(`/api/gaps/${source}/merge`)
      .send({ targetClusterId: target, itemIds: items.body.map((i: { id: string }) => i.id) })
      .expect(201);

    expect(res.body).toEqual({ targetClusterId: target, sourceSoftDeleted: true });
    const listed = await request(app.getHttpServer()).get("/api/gaps").expect(200);
    expect(listed.body.items.map((i: { id: string }) => i.id)).toEqual([target]);
    expect(listed.body.items[0].freq).toBe(2);
  });
});
