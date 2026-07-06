import { Module } from "@nestjs/common";
import { AppConfigModule } from "./platform/config/config.module";
import { PersistenceModule } from "./platform/persistence/persistence.module";
import { ClickHouseModule } from "./platform/clickhouse/clickhouse.module";
import { HealthModule } from "./modules/health/health.module";
import { TracesModule } from "./modules/traces/traces.module";
import { UsersModule } from "./modules/users/users.module";
import { AuthModule } from "./modules/auth/auth.module";

@Module({
  imports: [
    AppConfigModule,
    PersistenceModule,
    ClickHouseModule,
    HealthModule,
    TracesModule,
    UsersModule,
    AuthModule,
  ],
})
export class AppModule {}
