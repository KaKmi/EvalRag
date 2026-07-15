import { BadRequestException } from "@nestjs/common";
import { EvaluationsService } from "../src/modules/evaluations/evaluations.service";

describe("EvaluationsService", () => {
  const settings = {
    id: "default",
    enabled: false,
    sampleRate: 0.1,
    judgeModelId: null,
    embeddingModelId: null,
    faithfulnessThreshold: 85,
    answerRelevancyThreshold: 80,
    contextPrecisionThreshold: 80,
    dailyCap: 500,
    judgeVersion: "online-v1",
    updatedAt: new Date("2026-07-15T02:00:00.000Z"),
  };

  function setup() {
    const control = {
      getSettings: jest.fn().mockResolvedValue(settings),
      updateSettings: jest.fn().mockResolvedValue(settings),
      getOrCreateWatermark: jest.fn().mockResolvedValue({
        lastTs: new Date("2026-07-15T01:55:00.000Z"),
        dailyCount: 0,
      }),
    };
    const clickhouse = {
      getOverview: jest.fn().mockResolvedValue({
        sampleCount: 0,
        faithfulness: null,
        answerRelevancy: null,
        contextPrecision: null,
      }),
      getMinuteAggregates: jest.fn().mockResolvedValue([]),
      getByAgent: jest.fn().mockResolvedValue([]),
      getLowSamples: jest.fn().mockResolvedValue([]),
      countEligible: jest.fn().mockResolvedValue(0),
      countBacklog: jest.fn().mockResolvedValue(0),
      getLatestSuccess: jest.fn().mockResolvedValue(undefined),
      getLatestFailure: jest.fn().mockResolvedValue(undefined),
    };
    const models = { get: jest.fn(), list: jest.fn().mockResolvedValue([]) };
    const service = new EvaluationsService(control as never, clickhouse as never, models as never);
    return { service, control, clickhouse, models };
  }

  it("rejects enabling settings with a disabled or wrong-type model", async () => {
    const { service, models } = setup();
    models.get.mockResolvedValueOnce({ id: "m1", type: "embedding", enabled: true });
    await expect(
      service.updateSettings({ enabled: true, judgeModelId: "m1", embeddingModelId: "m2" }),
    ).rejects.toThrow(new BadRequestException("judgeModelId must reference an enabled llm model"));
  });

  it("returns the newest successful version before considering a later failure", async () => {
    const { service, clickhouse } = setup();
    clickhouse.getLatestSuccess.mockResolvedValue({
      targetTraceId: "a".repeat(32),
      judgeVersion: "online-v2",
      evaluatedAt: "2026-07-15T02:00:00.000Z",
      judgeModel: "judge-1",
      faithfulness: 90,
      answerRelevancy: 80,
      contextPrecision: 70,
      evidence: JSON.stringify({
        faithfulness: ["grounded"],
        answerRelevancy: ["relevant"],
        contextPrecision: ["one noisy chunk"],
      }),
    });
    clickhouse.getLatestFailure.mockResolvedValue({
      judgeVersion: "online-v1",
      failedAt: "2026-07-15T03:00:00.000Z",
      reason: "JudgeUnavailable: down",
    });

    await expect(service.getTraceQuality("a".repeat(32))).resolves.toMatchObject({
      status: "scored",
      judgeVersion: "online-v2",
      scores: { faithfulness: 90 },
      currentVersion: false,
    });
    expect(clickhouse.getLatestFailure).not.toHaveBeenCalled();
  });

  it("suppresses previous deltas below twenty samples", async () => {
    const { service, clickhouse } = setup();
    clickhouse.getOverview
      .mockResolvedValueOnce({
        sampleCount: 19,
        faithfulness: 90,
        answerRelevancy: 85,
        contextPrecision: 80,
      })
      .mockResolvedValueOnce({
        sampleCount: 100,
        faithfulness: 80,
        answerRelevancy: 80,
        contextPrecision: 80,
      });
    const result = await service.getOverview({}, new Date("2026-07-15T02:00:00.000Z"));
    expect(result.metrics.faithfulness).toMatchObject({ value: 90, previousDelta: null });
  });
});
