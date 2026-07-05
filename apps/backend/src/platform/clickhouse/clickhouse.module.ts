import { Global, Module } from "@nestjs/common";
import { createClient } from "@clickhouse/client";
import { AppConfigService } from "../config/config.service";
import { CLICKHOUSE } from "./clickhouse.constants";

@Global()
@Module({
  providers: [
    {
      provide: CLICKHOUSE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        createClient({
          url: config.clickHouseUrl,
          database: config.clickHouseDatabase,
          username: config.clickHouseUsername,
          password: config.clickHousePassword,
        }),
    },
  ],
  exports: [CLICKHOUSE],
})
export class ClickHouseModule {}
