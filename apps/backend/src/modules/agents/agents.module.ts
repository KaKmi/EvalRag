import { Module } from "@nestjs/common";
import { AgentsController } from "./agents.controller";
import { AgentsRepository } from "./agents.repository";
import { AgentsService } from "./agents.service";
import { ModelsModule } from "../models/models.module";
import { PromptsModule } from "../prompts/prompts.module";
import { KnowledgeBasesModule } from "../knowledge-bases/knowledge-bases.module";

// 依赖装配：ModelsModule 导出 ModelsService（type/enabled 校验）；
// PromptsModule 导出 PromptsService（getVersionMeta 校验 node 归属）；
// KnowledgeBasesModule 导出 KnowledgeBasesRepository（embedding 一致性批量查）。
// 三者均不依赖 agents，无模块环。
@Module({
  imports: [ModelsModule, PromptsModule, KnowledgeBasesModule],
  controllers: [AgentsController],
  providers: [AgentsRepository, AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
