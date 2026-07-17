// OTel 引导必须在任何被 instrument 的模块（http/express/pg）import 前生效——故置为首条 import。
// prod（node dist/main.js）与 dev（nest start）统一经此引导，dev 也能落 trace（不再靠外部 -r 预加载）。
import "./tracing";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { applyGlobalConfig, setupSwagger } from "./app/app-bootstrap";
import { AppConfigService } from "./platform/config/config.service";
import { parseProcessRole } from "./platform/config/process-role";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // dev 放开；后续收紧
  applyGlobalConfig(app); // 全局 /api 前缀（/health 除外）
  setupSwagger(app); // /api/docs UI + /api/docs-json
  const config = app.get(AppConfigService);
  await app.listen(config.port);
  console.log(`backend listening on :${config.port}`);
}

// 019 D2：worker 角色走 application context——无 HTTP、无端口、无重复 API 面；
// 全部模块照常实例化（QueueModule boss.start / processor 的 OnModuleInit 照跑，
// 消费门控由 RoleGatedQueueAdapter 决定）。enableShutdownHooks 让 SIGTERM 能走到
// QueueModule.onModuleDestroy 的 boss.stop()（api 分支现状无此钩子，属既有债务，019 A2 不动）。
async function bootstrapWorker() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  console.log("backend worker started (PROCESS_ROLE=worker): consuming eval-run + online-eval");
}

if (parseProcessRole(process.env) === "worker") {
  void bootstrapWorker();
} else {
  void bootstrap();
}
