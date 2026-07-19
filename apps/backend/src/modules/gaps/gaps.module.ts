import { Module } from "@nestjs/common";
import { EvalRunsModule } from "../eval-runs/eval-runs.module";
import { EvaluationsModule } from "../evaluations/evaluations.module";
import { ModelsModule } from "../models/models.module";
import { ClickHouseGapsRepository } from "./clickhouse-gaps.repository";
import { GapCollectorProcessor } from "./gap-collector.processor";
import { GapPromoteController } from "./gap-promote.controller";
import { GapPromoteService } from "./gap-promote.service";
import { GapsController } from "./gaps.controller";
import { GapsRepository } from "./gaps.repository";
import { GapsService } from "./gaps.service";

/**
 * 知识缺口 / 问题池域（021 决策 A）。
 *
 * **依赖顶点**：它 import `evaluations`（判官版本与 embedding 模型设置，只读）、`models`
 * （chat / embedTexts）与 `eval-runs`（`EvalSetsService.createCase`——[进评测集] 要在服务端
 * 批量建 gold 用例，021 决策 A 的既定边），但**没有任何模块 import 它**
 * ——`eslint.config.mjs` 的 Boundary ⑤ 机械保证。
 * 故这里 `exports` 是空的：导出任何东西都等于邀请别人建反向边。
 * 屏3 的「加入问题池」按钮走**前端组合**（021 决策 B），不是 `eval-runs → gaps`。
 *
 * `GapCollectorProcessor` 在这里注册后，它的 `onModuleInit` 才会挂上 cron
 * （`GAP_COLLECT_CRON`，每 30 分钟，worker 角色）——Task 5 交付时它还没有任何 module，等于不运行。
 * ClickHouse 客户端与 drizzle 都来自 `@Global()` 的 platform 模块，无需在此 import。
 */
@Module({
  imports: [EvaluationsModule, ModelsModule, EvalRunsModule],
  controllers: [GapsController, GapPromoteController],
  providers: [
    GapsRepository,
    ClickHouseGapsRepository,
    GapsService,
    GapPromoteService,
    GapCollectorProcessor,
  ],
})
export class GapsModule {}
