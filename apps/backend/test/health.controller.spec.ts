import { Test } from "@nestjs/testing";
import { HealthController } from "../src/modules/health/health.controller";
import { DRIZZLE } from "../src/platform/persistence/drizzle.constants";

async function build(execute: () => Promise<unknown>) {
  const ref = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: DRIZZLE, useValue: { execute } }],
  }).compile();
  return ref.get(HealthController);
}

describe("HealthController", () => {
  it("returns ok when db reachable", async () => {
    const ctrl = await build(async () => ({}));
    const res = await ctrl.check();
    expect(res.status).toBe("ok");
    expect(res.db).toBe("up");
  });
  it("returns error when db down", async () => {
    const ctrl = await build(async () => {
      throw new Error("down");
    });
    const res = await ctrl.check();
    expect(res.status).toBe("error");
    expect(res.db).toBe("down");
  });
});
