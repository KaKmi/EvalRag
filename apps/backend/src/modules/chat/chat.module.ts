import { Module } from "@nestjs/common";
import { ApplicationsModule } from "../applications/applications.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { KnowledgeBasesModule } from "../knowledge-bases/knowledge-bases.module";
import { NodeRuntimeModule } from "../node-runtime/node-runtime.module";
import { RetrievalModule } from "../retrieval/retrieval.module";
import { ChatController } from "./chat.controller";
import { OrchestrationService } from "./orchestration.service";

@Module({
  imports: [
    ApplicationsModule,
    NodeRuntimeModule,
    RetrievalModule,
    KnowledgeBasesModule,
    ConversationsModule,
  ],
  controllers: [ChatController],
  providers: [OrchestrationService],
  // 018 决策 A：eval-runs（新顶点）注入 OrchestrationService.runForEvaluation 走同一编排路径。
  // chat 本身不感知 eval-runs——依赖方向单向朝下，无环。
  exports: [OrchestrationService],
})
export class ChatModule {}
