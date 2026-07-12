import { Injectable, NotFoundException } from "@nestjs/common";
import type { Conversation, Message } from "@codecrush/contracts";
import {
  ConversationsRepository,
  type AppendMessageInput,
  type CreateConversationInput,
} from "./conversations.repository";

@Injectable()
export class ConversationsService {
  constructor(private readonly repo: ConversationsRepository) {}

  async list(agentId?: string): Promise<Conversation[]> {
    return await this.repo.list(agentId);
  }

  async get(id: string): Promise<Conversation> {
    const conv = await this.repo.getById(id);
    if (!conv) throw new NotFoundException(`conversation ${id} not found`);
    return conv;
  }

  async listMessages(convId: string): Promise<Message[]> {
    await this.get(convId); // 校验 conversation 存在
    return await this.repo.listMessages(convId);
  }

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    return await this.repo.createConversation(input);
  }

  async appendMessage(input: AppendMessageInput): Promise<Message> {
    return await this.repo.appendMessage(input);
  }
}
