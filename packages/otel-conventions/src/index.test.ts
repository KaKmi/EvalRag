import { describe, expect, it } from "vitest";
import { CODECRUSH_SPAN_KIND, GEN_AI, OTEL_OPERATIONS, RAG } from "./index";

describe("otel conventions", () => {
  it("exposes stable GenAI and RAG attribute keys", () => {
    expect(GEN_AI.REQUEST_MODEL).toBe("gen_ai.request.model");
    expect(GEN_AI.OPERATION_NAME).toBe("gen_ai.operation.name");
    expect(RAG.RETRIEVAL_TOP_K).toBe("rag.retrieval.top_k");
  });

  it("exposes generic operation and span kind names", () => {
    expect(OTEL_OPERATIONS.CHAT).toBe("chat");
    expect(OTEL_OPERATIONS.RETRIEVE).toBe("retrieve");
    expect(CODECRUSH_SPAN_KIND.LLM).toBe("llm");
    expect(CODECRUSH_SPAN_KIND.CUSTOM).toBe("custom");
  });
});
