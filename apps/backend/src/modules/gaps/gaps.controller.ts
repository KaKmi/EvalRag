import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  CreateGapItemRequestSchema,
  GapListQuerySchema,
  MergeGapRequestSchema,
  SplitGapRequestSchema,
  UpdateGapRootCauseRequestSchema,
  type CreateGapItemResponse,
  type GapCluster,
  type GapItem,
  type GapListResponse,
  type GapSummary,
} from "@codecrush/contracts";
import { GapsService } from "./gaps.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 屏5 问题池的 HTTP 端点（021 §17）。
 *
 * 校验一律 `safeParse` + 抛 `BadRequestException(issues)`，与 `EvaluationsController` 同款——
 * 不用 `createZodDto`，因为这些 schema 已经在契约包里定义好并被前端复用，再包一层 DTO
 * 会产生第二个真相来源。
 */
@Controller("gaps")
export class GapsController {
  constructor(private readonly service: GapsService) {}

  @Get()
  async list(@Query() raw: unknown): Promise<GapListResponse> {
    const parsed = GapListQuerySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.service.list(parsed.data);
  }

  @Get("summary")
  async summary(): Promise<GapSummary> {
    return this.service.summary();
  }

  @Get(":id/items")
  async items(@Param("id") id: string): Promise<GapItem[]> {
    return this.service.listItems(this.assertUuid(id));
  }

  /** 手动入池。命中既有 trace 时返回 `joinedExisting: true`，**不再插一行**（原型 `:648`）。 */
  @Post("items")
  @HttpCode(201)
  async addItem(@Body() raw: unknown): Promise<CreateGapItemResponse> {
    const parsed = CreateGapItemRequestSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.service.addItem(parsed.data);
  }

  @Post(":id/ignore")
  async ignore(@Param("id") id: string): Promise<GapCluster> {
    return this.service.transition(this.assertUuid(id), "ignore");
  }

  @Post(":id/reopen")
  async reopen(@Param("id") id: string): Promise<GapCluster> {
    return this.service.transition(this.assertUuid(id), "reopen");
  }

  @Post(":id/route-retrieval")
  async routeRetrieval(@Param("id") id: string): Promise<GapCluster> {
    return this.service.transition(this.assertUuid(id), "routeRetrieval");
  }

  @Patch(":id/root-cause")
  async rootCause(@Param("id") id: string, @Body() raw: unknown): Promise<GapCluster> {
    const parsed = UpdateGapRootCauseRequestSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.service.setRootCauseManual(this.assertUuid(id), parsed.data.rootCause);
  }

  @Post(":id/split")
  @HttpCode(201)
  async split(@Param("id") id: string, @Body() raw: unknown): Promise<{ newClusterId: string }> {
    const parsed = SplitGapRequestSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.service.split(this.assertUuid(id), parsed.data.itemIds);
  }

  @Post(":id/merge")
  async merge(
    @Param("id") id: string,
    @Body() raw: unknown,
  ): Promise<{ targetClusterId: string; sourceSoftDeleted: boolean }> {
    const parsed = MergeGapRequestSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.service.merge(this.assertUuid(id), parsed.data.targetClusterId, parsed.data.itemIds);
  }

  /**
   * 路径参数不经 Zod（`@Param` 拿到的是裸 string），手动挡一道。
   * 不挡的话一个非 UUID 会一路走到 SQL，PG 抛 `invalid input syntax for type uuid` ⇒ 500，
   * 而这本该是 400。
   */
  private assertUuid(id: string): string {
    if (!UUID.test(id)) throw new BadRequestException("id must be a UUID");
    return id;
  }
}
