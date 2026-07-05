import { ServiceUnavailableException } from "@nestjs/common";
import { TracesService } from "../src/modules/traces/traces.service";
import type { ClickHouseTracesRepository } from "../src/modules/traces/clickhouse-traces.repository";
import { emitManualHelloSpan } from "@codecrush/otel";

jest.mock("@codecrush/otel", () => ({
  emitManualHelloSpan: jest.fn(),
}));

const emitMock = emitManualHelloSpan as jest.MockedFunction<typeof emitManualHelloSpan>;

describe("TracesService.emitHello", () => {
  const service = new TracesService({} as ClickHouseTracesRepository);

  it("returns the span identity as a hello response", async () => {
    emitMock.mockResolvedValueOnce({
      traceId: "391dae938234560b16bb63f51501cb6f",
      spanId: "6bb63f51501cb6f1",
      name: "manual.hello",
    });
    await expect(service.emitHello()).resolves.toEqual({
      traceId: "391dae938234560b16bb63f51501cb6f",
      spanId: "6bb63f51501cb6f1",
      name: "manual.hello",
    });
  });

  it("rejects with 503 when tracing is disabled (noop tracer all-zero identity)", async () => {
    emitMock.mockResolvedValueOnce({
      traceId: "0".repeat(32),
      spanId: "0".repeat(16),
      name: "manual.hello",
    });
    await expect(service.emitHello()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
