import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { envSchema } from "./config.schema";
import { AppConfigService } from "./config.service";

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => envSchema.parse(raw), // 抛错即 fail-fast
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
