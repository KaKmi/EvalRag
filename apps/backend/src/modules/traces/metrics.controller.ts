import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";
import { MetricsQuerySchema, type MetricsOverviewResponse } from "@codecrush/contracts";
import { ClickHouseMetricsRepository } from "./clickhouse-metrics.repository";

@Controller("metrics")
export class MetricsController {
  constructor(private readonly repo: ClickHouseMetricsRepository) {}

  @Get("overview")
  async overview(@Query() raw: unknown): Promise<MetricsOverviewResponse> {
    const q = MetricsQuerySchema.safeParse(raw);
    if (!q.success) throw new BadRequestException(q.error.issues);
    return this.repo.getOverview(q.data);
  }

  @Get("apps/:id")
  async app(
    @Param("id") id: string,
    @Query() raw: unknown,
  ): Promise<MetricsOverviewResponse> {
    const q = MetricsQuerySchema.safeParse(raw);
    if (!q.success) throw new BadRequestException(q.error.issues);
    return this.repo.getAppMetrics(id, q.data);
  }
}
