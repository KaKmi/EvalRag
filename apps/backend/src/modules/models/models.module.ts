import { Module } from "@nestjs/common";
import { ModelsController } from "./models.controller";
import { ModelsRepository } from "./models.repository";
import { ModelsService } from "./models.service";
import { MODEL_PROVIDER_PORT } from "./model-provider.constants";
import { ProtocolDispatchAdapter } from "./adapters/protocol-dispatch.adapter";

@Module({
  controllers: [ModelsController],
  providers: [
    ModelsRepository,
    ModelsService,
    { provide: MODEL_PROVIDER_PORT, useClass: ProtocolDispatchAdapter },
  ],
  // M4 ingestion 拿 MODEL_PROVIDER_PORT（003:135），拿端口不拿适配器
  exports: [ModelsService, MODEL_PROVIDER_PORT],
})
export class ModelsModule {}
