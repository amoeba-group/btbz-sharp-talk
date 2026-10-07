/** Normalized AI request/response across providers (FR-070). */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompletionRequest {
  system?: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
  model: string;
  apiKey?: string;
  endpoint?: string;
}

export interface AiCompletionResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  provider: string;
  model: string;
  /**
   * The engine that should have answered failed and this text came from the
   * stub instead (PLN-261007 D4). Callers that reach a customer must not pass
   * it off as an answer: RAG reports no confidence, moderation blocks.
   */
  degraded?: boolean;
}

/** Embedding request/response (KB vector retrieval — PLAN-KB-VectorHybrid-Qdrant). */
export interface AiEmbeddingRequest {
  texts: string[];
  /** Retrieval asymmetry hint: queries and documents embed differently. */
  inputType: 'query' | 'document';
  model?: string;
  apiKey?: string;
}

export interface AiEmbeddingResult {
  vectors: number[][];
  tokensIn: number;
  provider: string;
  model: string;
  dimension: number;
}

export interface AiAdapter {
  readonly provider: string;
  complete(req: AiCompletionRequest): Promise<AiCompletionResult>;
  /** Optional — only embedding-capable adapters (voyage, stub) implement this. */
  embed?(req: AiEmbeddingRequest): Promise<AiEmbeddingResult>;
}
