import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateModelRequest,
  ModelProvider,
  ModelType,
  TestModelRequest,
  TestModelResponse,
  UpdateModelRequest,
} from "@codecrush/contracts";
import { withSpan } from "@codecrush/otel";
import { CODECRUSH_SPAN_KIND, GEN_AI, OTEL_OPERATIONS } from "@codecrush/otel-conventions";
import { ENCRYPTION } from "../../platform/security/security.constants";
import { EncryptionService } from "../../platform/security/encryption";
import { ModelsRepository } from "./models.repository";
import { MODEL_PROVIDER_PORT } from "./model-provider.constants";
import type { ModelCallConfig, ModelProviderPort } from "./ports/model-provider.port";
import type { ModelProviderRow, NewModelProvider } from "./schema";

const OP_BY_TYPE: Record<ModelType, string> = {
  llm: OTEL_OPERATIONS.CHAT,
  embedding: OTEL_OPERATIONS.EMBEDDINGS,
  rerank: OTEL_OPERATIONS.RERANK,
};
const KIND_BY_TYPE: Record<ModelType, string> = {
  llm: CODECRUSH_SPAN_KIND.LLM,
  embedding: CODECRUSH_SPAN_KIND.EMBEDDINGS,
  rerank: CODECRUSH_SPAN_KIND.RERANK,
};

@Injectable()
export class ModelsService {
  constructor(
    private readonly repo: ModelsRepository,
    @Inject(ENCRYPTION) private readonly enc: EncryptionService,
    @Inject(MODEL_PROVIDER_PORT) private readonly provider: ModelProviderPort,
  ) {}

  async list(): Promise<ModelProvider[]> {
    return (await this.repo.find()).map((r) => this.toModelProvider(r));
  }

  async get(id: string): Promise<ModelProvider> {
    return this.toModelProvider(await this.mustFind(id));
  }

  async create(req: CreateModelRequest): Promise<ModelProvider> {
    const { apiKey, ...rest } = req;
    const row = await this.repo.insert({ ...rest, apiKeyEnc: this.enc.encrypt(apiKey) });
    return this.toModelProvider(row);
  }

  async update(id: string, req: UpdateModelRequest): Promise<ModelProvider> {
    await this.mustFind(id);
    const { apiKey, ...rest } = req;
    const patch: Partial<NewModelProvider> = { ...rest };
    if (apiKey) patch.apiKeyEnc = this.enc.encrypt(apiKey);
    const row = await this.repo.update(id, patch);
    if (!row) throw new NotFoundException(`model ${id} not found`);
    return this.toModelProvider(row);
  }

  async remove(id: string): Promise<void> {
    await this.mustFind(id);
    await this.repo.delete(id);
  }

  async testById(id: string): Promise<TestModelResponse> {
    const row = await this.mustFind(id);
    return this.doTest({
      type: row.type as ModelType,
      provider: row.provider,
      name: row.name,
      baseUrl: row.baseUrl,
      deploymentId: row.deploymentId ?? undefined,
      apiKey: this.enc.decrypt(row.apiKeyEnc),
    });
  }

  async testConfig(req: TestModelRequest): Promise<TestModelResponse> {
    return this.doTest({ ...req });
  }

  // best-effort span：属性只含类型/供应商/模型名，永不含 apiKey
  private async doTest(config: ModelCallConfig): Promise<TestModelResponse> {
    return await withSpan(
      "model.test_connection",
      {
        attributes: {
          [GEN_AI.OPERATION_NAME]: OP_BY_TYPE[config.type],
          [GEN_AI.SYSTEM]: config.provider,
          [GEN_AI.REQUEST_MODEL]: config.deploymentId ?? config.name,
          "codecrush.span.kind": KIND_BY_TYPE[config.type],
        },
      },
      async () => {
        const r = await this.provider.testConnection(config);
        return { ok: r.ok, latencyMs: r.latencyMs, statusCode: r.statusCode, error: r.error };
      },
    );
  }

  private async mustFind(id: string): Promise<ModelProviderRow> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`model ${id} not found`);
    return row;
  }

  private toModelProvider(row: ModelProviderRow): ModelProvider {
    return {
      id: row.id,
      type: row.type as ModelType,
      provider: row.provider,
      name: row.name,
      baseUrl: row.baseUrl,
      deploymentId: row.deploymentId ?? undefined,
      enabled: row.enabled,
      apiKeyMasked: this.enc.maskApiKey(this.enc.decrypt(row.apiKeyEnc)),
    };
  }
}
