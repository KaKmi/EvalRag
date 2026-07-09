import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import {
  CreateAgentConfigVersionRequestSchema,
  CreateAgentRequestSchema,
  UpdateAgentRequestSchema,
  type Agent,
  type AgentConfigVersion,
} from "@codecrush/contracts";
import type { AuthenticatedUser } from "../../platform/security/authenticated-user";
import { AgentsService } from "./agents.service";

class CreateAgentRequestDto extends createZodDto(CreateAgentRequestSchema) {}
class UpdateAgentRequestDto extends createZodDto(UpdateAgentRequestSchema) {}
class CreateAgentConfigVersionRequestDto extends createZodDto(
  CreateAgentConfigVersionRequestSchema,
) {}

// guard 已在 canActivate 里挂 user（jwt-auth.guard.ts），此处仅声明所需结构。
type AuthedRequest = { user: AuthenticatedUser };

@Controller("agents")
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  list(): Promise<Agent[]> {
    return this.agentsService.list();
  }

  @Get(":id")
  get(@Param("id") id: string): Promise<Agent> {
    return this.agentsService.get(id);
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: CreateAgentRequestDto, @Req() req: AuthedRequest): Promise<Agent> {
    return this.agentsService.create(body, req.user.email);
  }

  // 编辑收窄：仅 name/desc/enabled（008 决策 3），契约 strictObject 拒绝其他键
  @Patch(":id")
  updateBase(
    @Param("id") id: string,
    @Body() body: UpdateAgentRequestDto,
    @Req() req: AuthedRequest,
  ): Promise<Agent> {
    return this.agentsService.updateBase(id, body, req.user.email);
  }

  @Get(":id/config-versions")
  listVersions(@Param("id") id: string): Promise<AgentConfigVersion[]> {
    return this.agentsService.listVersions(id);
  }

  @Post(":id/config-versions")
  @HttpCode(201)
  createVersion(
    @Param("id") id: string,
    @Body() body: CreateAgentConfigVersionRequestDto,
    @Req() req: AuthedRequest,
  ): Promise<AgentConfigVersion> {
    return this.agentsService.createVersion(id, body, req.user.email);
  }

  // M7 Eval stub：无请求体，硬编码置 passed（008 决策 2，M11 换真实评测）
  @Post(":id/config-versions/:versionId/eval-run")
  @HttpCode(200)
  evalRun(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
  ): Promise<AgentConfigVersion> {
    return this.agentsService.evalRun(id, versionId);
  }

  @Post(":id/config-versions/:versionId/publish")
  @HttpCode(200)
  publish(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @Req() req: AuthedRequest,
  ): Promise<AgentConfigVersion> {
    return this.agentsService.publish(id, versionId, req.user.email);
  }

  @Post(":id/config-versions/:versionId/rollback")
  @HttpCode(200)
  rollback(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @Req() req: AuthedRequest,
  ): Promise<AgentConfigVersion> {
    return this.agentsService.rollback(id, versionId, req.user.email);
  }
}
