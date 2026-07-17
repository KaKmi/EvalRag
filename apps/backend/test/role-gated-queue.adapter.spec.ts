import { RoleGatedQueueAdapter } from "../src/platform/queue/role-gated-queue.adapter";
import type { Queue } from "../src/platform/queue/queue.port";

function makeInner(): jest.Mocked<Queue> {
  return {
    publish: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
  };
}

describe("RoleGatedQueueAdapter（019 D1：消费门控在 Queue 实例层，processor 零感知）", () => {
  const handler = jest.fn(async () => undefined);

  it("consumeEnabled=false：subscribe/schedule no-op 且各记一条 log，inner 不被触碰", async () => {
    const inner = makeInner();
    const logger = { log: jest.fn() };
    const gated = new RoleGatedQueueAdapter(inner, false, "eval-run", logger);
    await gated.subscribe("offline-eval-run", handler);
    await gated.schedule("offline-eval-run", "*/15 * * * *", { a: 1 }, { key: "k" });
    expect(inner.subscribe).not.toHaveBeenCalled();
    expect(inner.schedule).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledTimes(2);
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("eval-run"));
  });

  it("consumeEnabled=false：publish 仍透传（019 Boundary 3——worker 的 lease_busy 重投依赖它）", async () => {
    const inner = makeInner();
    const gated = new RoleGatedQueueAdapter(inner, false, "eval-run", { log: jest.fn() });
    await gated.publish("offline-eval-run", { runId: "r1" }, { retryLimit: 3 });
    expect(inner.publish).toHaveBeenCalledWith(
      "offline-eval-run",
      { runId: "r1" },
      { retryLimit: 3 },
    );
  });

  it("consumeEnabled=true：三方法全部透传，不产生任何跳过 log", async () => {
    const inner = makeInner();
    const logger = { log: jest.fn() };
    const gated = new RoleGatedQueueAdapter(inner, true, "ingestion", logger);
    await gated.publish("ingest-document", { documentId: "d1" }, undefined);
    await gated.subscribe("ingest-document", handler);
    await gated.schedule("ingest-document", "* * * * *", {}, undefined);
    expect(inner.publish).toHaveBeenCalledTimes(1);
    expect(inner.subscribe).toHaveBeenCalledWith("ingest-document", handler);
    expect(inner.schedule).toHaveBeenCalledTimes(1);
    expect(logger.log).not.toHaveBeenCalled();
  });
});
