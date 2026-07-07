import { NotFoundException } from "@nestjs/common";
import { ModelsService } from "../src/modules/models/models.service";
import { EncryptionService } from "../src/platform/security/encryption";
import type { ModelsRepository } from "../src/modules/models/models.repository";
import type { ModelProviderPort } from "../src/modules/models/ports/model-provider.port";
import type { ModelProviderRow, NewModelProvider } from "../src/modules/models/schema";

const enc = new EncryptionService(Buffer.alloc(32, 7).toString("base64"));

function makeRepo(rows: ModelProviderRow[] = []) {
  return {
    rows,
    find: jest.fn(async () => rows),
    findById: jest.fn(async (id: string) => rows.find((r) => r.id === id)),
    insert: jest.fn(async (row: NewModelProvider): Promise<ModelProviderRow> => {
      const r: ModelProviderRow = {
        id: "m1",
        type: row.type,
        protocol: row.protocol,
        name: row.name,
        baseUrl: row.baseUrl,
        apiKeyEnc: row.apiKeyEnc,
        deploymentId: row.deploymentId ?? null,
        params: row.params ?? {},
        enabled: row.enabled ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.push(r);
      return r;
    }),
    update: jest.fn(async (id: string, patch: Partial<NewModelProvider>) => {
      const r = rows.find((x) => x.id === id);
      if (r) Object.assign(r, patch, { updatedAt: new Date() });
      return r;
    }),
    delete: jest.fn(async (id: string) => {
      const i = rows.findIndex((x) => x.id === id);
      if (i >= 0) rows.splice(i, 1);
    }),
  };
}

const port: jest.Mocked<ModelProviderPort> = {
  testConnection: jest.fn(async () => ({ ok: true, latencyMs: 5, statusCode: 200 })),
};

const createReq = {
  type: "llm" as const,
  protocol: "openai_compat" as const,
  name: "deepseek-chat",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-test12345678",
  params: { temperature: "0.3", max_tokens: "2048" },
  enabled: true,
};

describe("ModelsService", () => {
  beforeEach(() => port.testConnection.mockClear());

  it("create：repo 收到密文（非明文），响应只有掩码", async () => {
    const repo = makeRepo();
    const svc = new ModelsService(repo as unknown as ModelsRepository, enc, port);
    const created = await svc.create(createReq);
    const inserted = repo.insert.mock.calls[0][0];
    expect(inserted.apiKeyEnc.startsWith("v1:")).toBe(true);
    expect(inserted.apiKeyEnc).not.toContain("sk-test12345678");
    expect(inserted).not.toHaveProperty("apiKey");
    expect(created.apiKeyMasked).toBe("sk-****5678");
    expect(created).not.toHaveProperty("apiKey");
    expect(created).not.toHaveProperty("apiKeyEnc");
  });

  it("list：每行解密→掩码", async () => {
    const repo = makeRepo();
    const svc = new ModelsService(repo as unknown as ModelsRepository, enc, port);
    await svc.create(createReq);
    const [m] = await svc.list();
    expect(m.apiKeyMasked).toBe("sk-****5678");
  });

  it("update：带 apiKey 重加密；不带则 key 不变", async () => {
    const repo = makeRepo();
    const svc = new ModelsService(repo as unknown as ModelsRepository, enc, port);
    const created = await svc.create(createReq);
    const encBefore = repo.rows[0].apiKeyEnc;
    await svc.update(created.id, { enabled: false });
    expect(repo.rows[0].apiKeyEnc).toBe(encBefore);
    expect(repo.rows[0].enabled).toBe(false);
    await svc.update(created.id, { apiKey: "sk-newkey87654321" });
    expect(repo.rows[0].apiKeyEnc).not.toBe(encBefore);
    expect(enc.decrypt(repo.rows[0].apiKeyEnc)).toBe("sk-newkey87654321");
  });

  it("testById：解密后明文传给 port；不存在 → 404", async () => {
    const repo = makeRepo();
    const svc = new ModelsService(repo as unknown as ModelsRepository, enc, port);
    const created = await svc.create(createReq);
    const r = await svc.testById(created.id);
    expect(r).toMatchObject({ ok: true, latencyMs: 5, statusCode: 200 });
    expect(port.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-test12345678",
        type: "llm",
        protocol: "openai_compat",
        params: { temperature: "0.3", max_tokens: "2048" },
      }),
    );
    await expect(svc.testById("nope")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("remove：不存在 → 404；存在 → 删除", async () => {
    const repo = makeRepo();
    const svc = new ModelsService(repo as unknown as ModelsRepository, enc, port);
    await expect(svc.remove("nope")).rejects.toBeInstanceOf(NotFoundException);
    const created = await svc.create(createReq);
    await svc.remove(created.id);
    expect(repo.rows).toHaveLength(0);
  });
});
