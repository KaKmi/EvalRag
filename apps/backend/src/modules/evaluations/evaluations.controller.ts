import { BadRequestException, Body, Controller, Get, Param, Put, Query } from "@nestjs/common";
import {
  QualityOverviewQuerySchema,
  UpdateOnlineEvalSettingsRequestSchema,
  type OnlineEvalSettingsResponse,
  type QualityOverviewResponse,
  type TraceQualityDetail,
} from "@codecrush/contracts";
import { EvaluationsService } from "./evaluations.service";

const TRACE_ID = /^[a-f0-9]{32}$/i;

@Controller("eval/quality")
export class EvaluationsController {
  constructor(private readonly service: EvaluationsService) {}

  @Get("overview")
  async overview(@Query() raw: unknown): Promise<QualityOverviewResponse> {
    const parsed = QualityOverviewQuerySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.service.getOverview(parsed.data);
  }

  @Get("traces/:traceId")
  async trace(@Param("traceId") traceId: string): Promise<TraceQualityDetail> {
    if (!TRACE_ID.test(traceId)) throw new BadRequestException("traceId must be 32 hex characters");
    return this.service.getTraceQuality(traceId);
  }

  @Get("settings")
  async settings(): Promise<OnlineEvalSettingsResponse> {
    return this.service.getSettings();
  }

  @Put("settings")
  async update(@Body() raw: unknown): Promise<OnlineEvalSettingsResponse> {
    const parsed = UpdateOnlineEvalSettingsRequestSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.service.updateSettings(parsed.data);
  }
}
