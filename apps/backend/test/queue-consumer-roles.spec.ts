import { QUEUE_CONSUMER_ROLES } from "../src/platform/queue/queue.constants";
import { PROCESS_ROLES } from "../src/platform/config/process-role";

describe("QUEUE_CONSUMER_ROLES（019 Boundary 1：消费角色的唯一登记处）", () => {
  it("api 只消费 ingestion + releaseCheck", () => {
    const consumedByApi = Object.entries(QUEUE_CONSUMER_ROLES)
      .filter(([, roles]) => (roles as readonly string[]).includes("api"))
      .map(([key]) => key)
      .sort();
    expect(consumedByApi).toEqual(["ingestion", "releaseCheck"]);
  });

  it("worker 只消费 evaluation + evalRun", () => {
    const consumedByWorker = Object.entries(QUEUE_CONSUMER_ROLES)
      .filter(([, roles]) => (roles as readonly string[]).includes("worker"))
      .map(([key]) => key)
      .sort();
    expect(consumedByWorker).toEqual(["evalRun", "evaluation"]);
  });

  it("all 出现在每一个登记项里（all = 现行为的兜底）", () => {
    for (const roles of Object.values(QUEUE_CONSUMER_ROLES)) {
      expect(roles).toContain("all");
    }
  });

  it("登记项恰是 4 个消费者域，且角色值全部合法", () => {
    expect(Object.keys(QUEUE_CONSUMER_ROLES).sort()).toEqual([
      "evalRun",
      "evaluation",
      "ingestion",
      "releaseCheck",
    ]);
    for (const roles of Object.values(QUEUE_CONSUMER_ROLES)) {
      for (const role of roles) expect(PROCESS_ROLES).toContain(role);
    }
  });
});
