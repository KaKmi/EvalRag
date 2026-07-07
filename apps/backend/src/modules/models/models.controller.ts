import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import {
  CreateModelRequestSchema,
  TestModelRequestSchema,
  UpdateModelRequestSchema,
  type ModelProvider,
  type TestModelResponse,
} from "@codecrush/contracts";
import { ModelsService } from "./models.service";

class CreateModelRequestDto extends createZodDto(CreateModelRequestSchema) {}
class UpdateModelRequestDto extends createZodDto(UpdateModelRequestSchema) {}
class TestModelRequestDto extends createZodDto(TestModelRequestSchema) {}

@Controller("models")
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Get()
  list(): Promise<ModelProvider[]> {
    return this.modelsService.list();
  }

  // ad-hoc 连通性测试（抽屉保存前验活，不落库）。静态段 "test" 先于参数路由声明
  @Post("test")
  @HttpCode(200)
  testConfig(@Body() body: TestModelRequestDto): Promise<TestModelResponse> {
    return this.modelsService.testConfig(body);
  }

  @Get(":id")
  get(@Param("id") id: string): Promise<ModelProvider> {
    return this.modelsService.get(id);
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: CreateModelRequestDto): Promise<ModelProvider> {
    return this.modelsService.create(body);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: UpdateModelRequestDto): Promise<ModelProvider> {
    return this.modelsService.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id") id: string): Promise<void> {
    return this.modelsService.remove(id);
  }

  @Post(":id/test")
  @HttpCode(200)
  test(@Param("id") id: string): Promise<TestModelResponse> {
    return this.modelsService.testById(id);
  }
}
