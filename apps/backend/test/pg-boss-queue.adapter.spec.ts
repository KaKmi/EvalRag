import { PgBossQueueAdapter } from "../src/platform/queue/pg-boss-queue.adapter";

function makeFakeBoss() {
  return {
    send: jest.fn(async () => "job-id-1"),
    work: jest.fn(async () => undefined),
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
  };
}

describe("PgBossQueueAdapter", () => {
  it("publish：把 singletonKey/retryLimit 映射为 pg-boss send options", async () => {
    const boss = makeFakeBoss();
    const adapter = new PgBossQueueAdapter(boss as never);
    await adapter.publish(
      "ingest-document",
      { documentId: "d1" },
      {
        singletonKey: "d1",
        retryLimit: 1,
      },
    );
    expect(boss.send).toHaveBeenCalledWith(
      "ingest-document",
      { documentId: "d1" },
      expect.objectContaining({ singletonKey: "d1", retryLimit: 1 }),
    );
  });

  it("subscribe：注册 handler 并在收到 job 时以 job.data 调用", async () => {
    const boss = makeFakeBoss();
    const adapter = new PgBossQueueAdapter(boss as never);
    const handler = jest.fn(async () => undefined);
    await adapter.subscribe("ingest-document", handler);
    expect(boss.work).toHaveBeenCalledWith("ingest-document", expect.any(Function));
    // 模拟 pg-boss 调用 work 注册的回调
    const registeredCallback = boss.work.mock.calls[0][1];
    await registeredCallback([{ data: { documentId: "d1" } }]);
    expect(handler).toHaveBeenCalledWith({ documentId: "d1" });
  });
});
