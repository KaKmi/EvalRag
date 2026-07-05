export const GEN_AI = {
  SYSTEM: "gen_ai.system",
  OPERATION_NAME: "gen_ai.operation.name",
  REQUEST_MODEL: "gen_ai.request.model",
  USAGE_INPUT_TOKENS: "gen_ai.usage.input_tokens",
  USAGE_OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  TOOL_NAME: "gen_ai.tool.name",
  TOOL_CALL_ID: "gen_ai.tool.call.id",
  TOOL_TYPE: "gen_ai.tool.type",
  AGENT_NAME: "gen_ai.agent.name",
  AGENT_ID: "gen_ai.agent.id",
} as const;

export const RAG = {
  RETRIEVAL_TOP_K: "rag.retrieval.top_k",
  RETRIEVAL_TOP_N: "rag.retrieval.top_n",
  RETRIEVAL_THRESHOLD: "rag.retrieval.threshold",
  MULTI_RECALL: "rag.multi",
  CHUNK_SCORES: "rag.chunk.scores",
  CITATION_IDS: "rag.citation.ids",
  COST_USD: "rag.cost.usd",
  PROMPT_VERSION_ID: "rag.prompt.version_id",
} as const;

export const OTEL_OPERATIONS = {
  CHAT: "chat",
  TEXT_COMPLETION: "text_completion",
  EMBEDDINGS: "embeddings",
  EXECUTE_TOOL: "execute_tool",
  INVOKE_AGENT: "invoke_agent",
  CREATE_AGENT: "create_agent",
  RETRIEVE: "retrieve",
  RERANK: "rerank",
  KEYWORD_RECALL: "keyword_recall",
  HITS: "hits",
  CUSTOM: "custom",
} as const;

export const CODECRUSH_SPAN_KIND = {
  LLM: "llm",
  EMBEDDINGS: "embeddings",
  RETRIEVAL: "retrieval",
  RERANK: "rerank",
  TOOL: "tool",
  AGENT: "agent",
  EVENT: "event",
  CUSTOM: "custom",
} as const;
