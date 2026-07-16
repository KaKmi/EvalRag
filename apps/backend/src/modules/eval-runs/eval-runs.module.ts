import { Module } from "@nestjs/common";
import { EvalSetsController } from "./eval-sets.controller";
import { EvalSetsRepository } from "./eval-sets.repository";
import { EvalSetsService } from "./eval-sets.service";

/**
 * 018 决策 A：`eval-runs` 是依赖顶点 —— 它 import 别人，别人不 import 它。
 * 评测集 CRUD 只碰自己域的表（DRIZZLE 来自 @Global 的 PersistenceModule），无跨域依赖。
 */
// Story 6: + ChatModule / EvaluationsModule / ApplicationsModule for the run engine
@Module({
  controllers: [EvalSetsController],
  providers: [EvalSetsRepository, EvalSetsService],
})
export class EvalRunsModule {}
