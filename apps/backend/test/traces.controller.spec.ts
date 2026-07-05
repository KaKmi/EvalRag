import { Test } from "@nestjs/testing";
import type { HelloTraceResponse, TraceDetailResponse } from "@codecrush/contracts";
import { TracesController } from "../src/modules/traces/traces.controller";
import { TracesService } from "../src/modules/traces/traces.service";

describe("TracesController", () => {
  async function build(service: Partial<TracesService>) {
    const ref = await Test.createTestingModule({
      controllers: [TracesController],
      providers: [{ provide: TracesService, useValue: service }],
    }).compile();
    return ref.get(TracesController);
  }

  it("emits a manual hello span", async () => {
    const response: HelloTraceResponse = {
      traceId: "391dae938234560b16bb63f51501cb6f",
      spanId: "6bb63f51501cb6f1",
      name: "manual.hello",
    };
    const ctrl = await build({ emitHello: async () => response } as Partial<TracesService>);
    await expect(ctrl.emitHello()).resolves.toEqual(response);
  });

  it("reads normalized trace detail by trace id", async () => {
    const detail: TraceDetailResponse = {
      traceId: "391dae938234560b16bb63f51501cb6f",
      spans: [
        {
          traceId: "391dae938234560b16bb63f51501cb6f",
          spanId: "6bb63f51501cb6f1",
          parentSpanId: null,
          name: "manual.hello",
          kind: "custom",
          startTime: "2026-07-05T00:00:00.000Z",
          durationMs: 1,
          statusCode: "Ok",
          attributes: { "codecrush.test": "hello" },
        },
      ],
    };
    const ctrl = await build({ getTrace: async () => detail } as Partial<TracesService>);
    await expect(ctrl.getTrace("391dae938234560b16bb63f51501cb6f")).resolves.toEqual(detail);
  });
});
