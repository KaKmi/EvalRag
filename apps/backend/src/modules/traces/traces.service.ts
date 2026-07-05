import { Injectable } from "@nestjs/common";
import { emitManualHelloSpan } from "@codecrush/otel";
import type { HelloTraceResponse, TraceDetailResponse } from "@codecrush/contracts";
import { ClickHouseTracesRepository } from "./clickhouse-traces.repository";

@Injectable()
export class TracesService {
  constructor(private readonly tracesRepository: ClickHouseTracesRepository) {}

  async emitHello(): Promise<HelloTraceResponse> {
    // SpanIdentity.name 是 string，HelloTraceResponse.name 是字面量 "manual.hello"；显式构造以满足契约类型
    const { traceId, spanId } = await emitManualHelloSpan();
    return { traceId, spanId, name: "manual.hello" };
  }

  async getTrace(traceId: string): Promise<TraceDetailResponse> {
    return await this.tracesRepository.findByTraceId(traceId);
  }
}
