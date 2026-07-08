import { IngestionService } from "../src/modules/ingestion/ingestion.service";
import type { Queue } from "../src/platform/queue/queue.port";
import type { BlobStore } from "../src/platform/storage/blob-store.port";
import type { DocumentsRepository } from "../src/modules/documents/documents.repository";
import type { KnowledgeBasesRepository } from "../src/modules/knowledge-bases/knowledge-bases.repository";
import type { IngestionPipelinePort } from "../src/modules/ingestion/ports/ingestion-pipeline.port";

function makeDeps() {
  const queue: jest.Mocked<Queue> = { publish: jest.fn(), subscribe: jest.fn() };
  const blobStore: jest.Mocked<BlobStore> = {
    put: jest.fn(),
    get: jest.fn(async () => Buffer.from("hello")),
    delete: jest.fn(),
  };
  const docsRepo = {
    findById: jest.fn(),
    update: jest.fn(async (id: string, patch: unknown) => ({ id, ...(patch as object) })),
    appendLifecycleStage: jest.fn(),
  };
  const kbRepo = { findById: jest.fn() };
  const pipeline: jest.Mocked<IngestionPipelinePort> = { run: jest.fn() };
  return { queue, blobStore, docsRepo, kbRepo, pipeline };
}

function makeService(deps: ReturnType<typeof makeDeps>): IngestionService {
  return new IngestionService(
    deps.queue,
    deps.blobStore,
    deps.docsRepo as unknown as DocumentsRepository,
    deps.kbRepo as unknown as KnowledgeBasesRepository,
    deps.pipeline,
  );
}

describe("IngestionService.enqueue", () => {
  it("发布任务时 singletonKey=documentId、retryLimit=1，先标 queued", async () => {
    const deps = makeDeps();
    const svc = makeService(deps);
    await svc.enqueue("d1", 1);
    expect(deps.docsRepo.update).toHaveBeenCalledWith("d1", { status: "queued" });
    expect(deps.queue.publish).toHaveBeenCalledWith(
      "ingest-document",
      { documentId: "d1", targetVersion: 1 },
      { singletonKey: "d1", retryLimit: 1 },
    );
  });
});

describe("IngestionService.processDocument", () => {
  it("成功路径：processing -> pipeline.run -> ready + chunkVersion + lifecycle done", async () => {
    const deps = makeDeps();
    deps.docsRepo.findById.mockResolvedValue({
      id: "d1",
      kbId: "kb1",
      type: "text",
      blobKey: "kb/kb1/d1/original.txt",
    });
    deps.kbRepo.findById.mockResolvedValue({
      id: "kb1",
      chunkTemplate: "general",
      embeddingModelId: "m1",
    });
    deps.pipeline.run.mockResolvedValue({ chunkCount: 3, parsedText: "hello" });

    const svc = makeService(deps);
    await svc.processDocument("d1", 1);

    expect(deps.docsRepo.update).toHaveBeenCalledWith("d1", { status: "processing" });
    expect(deps.pipeline.run).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "d1", kbId: "kb1", targetVersion: 1 }),
    );
    expect(deps.docsRepo.update).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({
        status: "ready",
        chunkVersion: 1,
        parsedText: "hello",
        error: null,
      }),
    );
    expect(deps.docsRepo.appendLifecycleStage).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ stage: "ready", status: "done" }),
    );
  });

  it("文档已被删除（findById 返回 undefined）时静默返回，不抛错、不跑管线", async () => {
    const deps = makeDeps();
    deps.docsRepo.findById.mockResolvedValue(undefined);
    const svc = makeService(deps);
    await expect(svc.processDocument("gone", 1)).resolves.toBeUndefined();
    expect(deps.pipeline.run).not.toHaveBeenCalled();
    expect(deps.docsRepo.update).not.toHaveBeenCalled();
  });

  it("pipeline.run 抛错时：文档标记 failed + error 消息 + lifecycle failed，不重新抛出", async () => {
    const deps = makeDeps();
    deps.docsRepo.findById.mockResolvedValue({ id: "d1", kbId: "kb1", type: "pdf", blobKey: "x" });
    deps.kbRepo.findById.mockResolvedValue({
      id: "kb1",
      chunkTemplate: "general",
      embeddingModelId: "m1",
    });
    deps.pipeline.run.mockRejectedValue(new Error("解析失败：扫描件"));

    const svc = makeService(deps);
    await expect(svc.processDocument("d1", 1)).resolves.toBeUndefined();
    expect(deps.docsRepo.update).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ status: "failed", error: "解析失败：扫描件" }),
    );
    expect(deps.docsRepo.appendLifecycleStage).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ stage: "ingest", status: "failed", error: "解析失败：扫描件" }),
    );
    expect(deps.docsRepo.update).not.toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ status: "ready" }),
    );
  });

  it("HOST 裁定：管线返回 chunkCount=0 时按失败处理（failed + 可读错误），不置 ready", async () => {
    const deps = makeDeps();
    deps.docsRepo.findById.mockResolvedValue({ id: "d1", kbId: "kb1", type: "text", blobKey: "x" });
    deps.kbRepo.findById.mockResolvedValue({
      id: "kb1",
      chunkTemplate: "general",
      embeddingModelId: "m1",
    });
    deps.pipeline.run.mockResolvedValue({ chunkCount: 0, parsedText: "" });

    const svc = makeService(deps);
    await expect(svc.processDocument("d1", 1)).resolves.toBeUndefined();
    expect(deps.docsRepo.update).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ status: "failed", error: "解析结果为空，未产生任何切片" }),
    );
    expect(deps.docsRepo.update).not.toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ status: "ready" }),
    );
  });
});
