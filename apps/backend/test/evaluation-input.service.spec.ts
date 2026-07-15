import type { ChunksService } from "../src/modules/chunks/chunks.service";
import type { ConversationsService } from "../src/modules/conversations/conversations.service";
import { EvaluationInputService } from "../src/modules/evaluations/evaluation-input.service";

const candidate = {
  traceId: "a".repeat(32),
  agentId: "app-1",
  generationModel: "qwen",
  retrievalChunks: [{ chunkId: "c1", finalScore: 0.8 }],
};

describe("EvaluationInputService", () => {
  let conversations: { findEvaluationTurnByTraceId: jest.Mock };
  let chunks: { findByIds: jest.Mock };
  let service: EvaluationInputService;

  beforeEach(() => {
    conversations = { findEvaluationTurnByTraceId: jest.fn() };
    chunks = { findByIds: jest.fn() };
    service = new EvaluationInputService(
      conversations as unknown as ConversationsService,
      chunks as unknown as ChunksService,
    );
  });

  it("uses PG turn text and merges duplicate retrieval chunks by best final score", async () => {
    conversations.findEvaluationTurnByTraceId.mockResolvedValue({
      agentId: "app-1",
      question: "原始手机号 13800001111 能退款吗",
      answer: "可以在七天内申请",
    });
    chunks.findByIds.mockResolvedValue([
      { id: "c2", text: "七天退款规则" },
      { id: "c1", text: "退款申请入口" },
    ]);

    await expect(
      service.assemble({
        ...candidate,
        retrievalChunks: [
          { chunkId: "c1", finalScore: 0.7 },
          { chunkId: "c2", finalScore: 0.9 },
          { chunkId: "c1", finalScore: 0.8 },
        ],
      }),
    ).resolves.toEqual({
      status: "ready",
      input: {
        targetTraceId: "a".repeat(32),
        question: "原始手机号 13800001111 能退款吗",
        answer: "可以在七天内申请",
        contexts: [
          { chunkId: "c2", text: "七天退款规则", finalScore: 0.9 },
          { chunkId: "c1", text: "退款申请入口", finalScore: 0.8 },
        ],
      },
      missingChunkIds: [],
    });
    expect(chunks.findByIds).toHaveBeenCalledWith(["c2", "c1"]);
  });

  it("marks a missing persisted turn incomplete instead of using redacted trace IO", async () => {
    conversations.findEvaluationTurnByTraceId.mockResolvedValue(undefined);
    await expect(service.assemble(candidate)).resolves.toEqual({
      status: "incomplete",
      reason: "turn_not_found",
    });
    expect(chunks.findByIds).not.toHaveBeenCalled();
  });

  it("keeps stable score order, caps contexts at 20, and reports missing chunks", async () => {
    conversations.findEvaluationTurnByTraceId.mockResolvedValue({
      agentId: "app-1",
      question: "question",
      answer: "answer",
    });
    const retrievalChunks = Array.from({ length: 22 }, (_, index) => ({
      chunkId: `c${index}`,
      finalScore: index < 2 ? 1 : 1 - index / 100,
    }));
    chunks.findByIds.mockImplementation(async (ids: string[]) =>
      ids
        .filter((id) => id !== "c4")
        .reverse()
        .map((id) => ({ id, text: `text-${id}` })),
    );

    const result = await service.assemble({ ...candidate, retrievalChunks });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready input");
    expect(chunks.findByIds.mock.calls[0][0]).toHaveLength(20);
    expect(result.input.contexts.map((context) => context.chunkId).slice(0, 4)).toEqual([
      "c0",
      "c1",
      "c2",
      "c3",
    ]);
    expect(result.input.contexts).toHaveLength(19);
    expect(result.missingChunkIds).toEqual(["c4"]);
  });

  it("returns a ready input with zero contexts", async () => {
    conversations.findEvaluationTurnByTraceId.mockResolvedValue({
      agentId: "app-1",
      question: "question",
      answer: "answer",
    });
    chunks.findByIds.mockResolvedValue([]);

    await expect(service.assemble({ ...candidate, retrievalChunks: [] })).resolves.toEqual({
      status: "ready",
      input: {
        targetTraceId: candidate.traceId,
        question: "question",
        answer: "answer",
        contexts: [],
      },
      missingChunkIds: [],
    });
  });
});
