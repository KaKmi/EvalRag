/** OpenTelemetry GenAI 语义约定 key（M0.5+ 埋点使用） */
export const GEN_AI = {
  SYSTEM: "gen_ai.system",
  REQUEST_MODEL: "gen_ai.request.model",
  USAGE_INPUT_TOKENS: "gen_ai.usage.input_tokens",
  USAGE_OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
} as const;

/** RAG 专有 span 属性 key */
export const RAG = {
  RETRIEVAL_TOP_K: "rag.retrieval.top_k",
  CHUNK_SCORES: "rag.chunk.scores",
  CITATION_IDS: "rag.citation.ids",
  COST_USD: "rag.cost.usd",
  PROMPT_VERSION_ID: "rag.prompt.version_id",
} as const;
