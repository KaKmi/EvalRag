import { Controller, Get, Param, Post } from "@nestjs/common";
import type { HelloTraceResponse, TraceDetailResponse } from "@codecrush/contracts";
import { TracesService } from "./traces.service";

@Controller("traces")
export class TracesController {
  constructor(private readonly tracesService: TracesService) {}

  @Post("hello")
  async emitHello(): Promise<HelloTraceResponse> {
    return await this.tracesService.emitHello();
  }

  @Get(":traceId")
  async getTrace(@Param("traceId") traceId: string): Promise<TraceDetailResponse> {
    return await this.tracesService.getTrace(traceId);
  }
}
