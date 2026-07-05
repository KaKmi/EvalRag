import { Module } from "@nestjs/common";
import { AppConfigModule } from "./platform/config/config.module";
import { PersistenceModule } from "./platform/persistence/persistence.module";
import { HealthModule } from "./modules/health/health.module";

@Module({ imports: [AppConfigModule, PersistenceModule, HealthModule] })
export class AppModule {}
