import { Controller, Get, Param } from "@nestjs/common";
import type { Conversation, Message } from "@codecrush/contracts";
import { ConversationsService } from "./conversations.service";

@Controller("conversations")
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  async list(): Promise<Conversation[]> {
    return this.conversationsService.list();
  }

  @Get(":id")
  async get(@Param("id") id: string): Promise<Conversation> {
    return this.conversationsService.get(id);
  }

  @Get(":id/messages")
  async listMessages(@Param("id") id: string): Promise<Message[]> {
    return this.conversationsService.listMessages(id);
  }
}
