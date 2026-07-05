import { Module } from "@nestjs/common";
import { ClickHouseModule } from "../../platform/clickhouse/clickhouse.module";
import { ClickHouseTracesRepository } from "./clickhouse-traces.repository";
import { TracesController } from "./traces.controller";
import { TracesService } from "./traces.service";

@Module({
  imports: [ClickHouseModule],
  controllers: [TracesController],
  providers: [ClickHouseTracesRepository, TracesService],
})
export class TracesModule {}
