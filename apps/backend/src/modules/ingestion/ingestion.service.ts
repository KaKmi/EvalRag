import { Inject, Injectable } from "@nestjs/common";
import type { ChunkTemplate, DocumentType } from "@codecrush/contracts";
import { BLOB_STORE } from "../../platform/storage/blob-store.constants";
import type { BlobStore } from "../../platform/storage/blob-store.port";
import { INGESTION_QUEUE } from "../../platform/queue/queue.constants";
import type { Queue } from "../../platform/queue/queue.port";
import { DocumentsRepository } from "../documents/documents.repository";
import { KnowledgeBasesRepository } from "../knowledge-bases/knowledge-bases.repository";
import { INGESTION_PIPELINE_PORT } from "./ingestion.constants";
import type { IngestionPipelinePort } from "./ports/ingestion-pipeline.port";
import { INGEST_DOCUMENT_JOB } from "./ingestion-job.constants";

const nowIso = (): string => new Date().toISOString();

@Injectable()
export class IngestionService {
  constructor(
    @Inject(INGESTION_QUEUE) private readonly queue: Queue,
    @Inject(BLOB_STORE) private readonly blobStore: BlobStore,
    private readonly docsRepo: DocumentsRepository,
    private readonly kbRepo: KnowledgeBasesRepository,
    @Inject(INGESTION_PIPELINE_PORT) private readonly pipeline: IngestionPipelinePort,
  ) {}

  // 上传 autoParse=true 或手动 /parse 触发都走这里：立即标 queued + 发布任务，HTTP 立即返回（007 禁止同步入库）。
  // singletonKey=documentId + retryLimit=1：同一文档重复入队不并行双跑、失败不自动重试（幂等由 queue 保证）。
  async enqueue(documentId: string, targetVersion: number): Promise<void> {
    await this.docsRepo.update(documentId, { status: "queued" });
    await this.queue.publish(
      INGEST_DOCUMENT_JOB,
      { documentId, targetVersion },
      { singletonKey: documentId, retryLimit: 1 },
    );
  }

  // pg-boss worker 回调实体：读文档+所属 kb -> 取 blob -> 跑管线 -> 落地终态。
  // 阶段异常一律捕获落 failed（不抛出、不自动重试），便于 T17 kb-rebuild 在终态之上插回调。
  async processDocument(documentId: string, targetVersion: number): Promise<void> {
    const doc = await this.docsRepo.findById(documentId);
    if (!doc) return; // 文档在排队期间被删除：静默完成，不视为失败（幂等）

    await this.docsRepo.update(documentId, { status: "processing" });
    await this.docsRepo.appendLifecycleStage(documentId, {
      stage: "ingest",
      status: "running",
      startedAt: nowIso(),
      endedAt: null,
    });

    try {
      const kb = await this.kbRepo.findById(doc.kbId);
      const blob = await this.blobStore.get(doc.blobKey);
      const result = await this.pipeline.run({
        documentId,
        kbId: doc.kbId,
        docType: doc.type as DocumentType,
        chunkTemplate: (kb?.chunkTemplate ?? "general") as ChunkTemplate,
        embeddingModelId: kb?.embeddingModelId ?? "",
        targetVersion,
        blob,
      });

      // HOST 裁定：ready 但 0 切片会误导用户，按失败处理（走 catch 落 failed + 可读错误）。
      if (result.chunkCount === 0) {
        throw new Error("解析结果为空，未产生任何切片");
      }

      await this.docsRepo.update(documentId, {
        status: "ready",
        chunkVersion: targetVersion,
        parsedText: result.parsedText,
        error: null,
      });
      await this.docsRepo.appendLifecycleStage(documentId, {
        stage: "ready",
        status: "done",
        startedAt: nowIso(),
        endedAt: nowIso(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.docsRepo.update(documentId, { status: "failed", error: message });
      await this.docsRepo.appendLifecycleStage(documentId, {
        stage: "ingest",
        status: "failed",
        startedAt: nowIso(),
        endedAt: nowIso(),
        error: message,
      });
    }
  }
}
