import { BadRequestException, Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import {
  DraftGoldRequestSchema,
  PromoteGapRequestSchema,
  type DraftGoldResponse,
  type PromoteGapResponse,
} from "@codecrush/contracts";
import type { AuthenticatedUser } from "../../platform/security/authenticated-user";
import { GapPromoteService } from "./gap-promote.service";

type AuthedRequest = { user: AuthenticatedUser };

/**
 * 「从坏样本生成」的两个端点（021 §17.2 `:596`）。
 *
 * **为什么单独开一个 controller 而不是并进 `GapsController`**：`GapsController` 的动词路由
 * 全是**两段式** `:id/xxx`（ignore / reopen / route-retrieval / split / merge / items），
 * 而这里的两条是**一段式** `promote` / `draft-gold`——两种形状在 Nest 的路由表里永不相交，
 * 不存在 `:id` 抢占 `promote` 的可能（已实测枚举路由表确认）。既然没有冲突，就按职责拆：
 * 状态机与簇操作是一码事，跨域沉淀 gold 用例（`gaps → eval-runs`）是另一码事。
 *
 * 校验一律 `safeParse` + `BadRequestException(issues)`，与 `GapsController` 同款。
 */
@Controller("gaps")
export class GapPromoteController {
  constructor(private readonly service: GapPromoteService) {}

  /**
   * **同步单条**（与 plan 的「建批次 + 轮询」偏离，已拍板）：原型要的是第②步行内逐条 Spin，
   * 一次请求一次 LLM 调用不会顶爆 HTTP 超时，省掉一个队列 token、一张批次表与一套轮询状态机。
   * 并发由前端自行限流（最多 3 条），避免 N 条同时打爆判官模型。
   */
  @Post("draft-gold")
  @HttpCode(200)
  async draftGold(@Body() raw: unknown): Promise<DraftGoldResponse> {
    const parsed = DraftGoldRequestSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.service.draftGold(parsed.data);
  }

  @Post("promote")
  @HttpCode(201)
  async promote(@Body() raw: unknown, @Req() req: AuthedRequest): Promise<PromoteGapResponse> {
    const parsed = PromoteGapRequestSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.service.promote(parsed.data, req.user.email);
  }
}
