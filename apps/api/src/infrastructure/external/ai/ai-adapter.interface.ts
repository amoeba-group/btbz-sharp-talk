/** Normalized AI request/response across providers (FR-070). */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Content blocks of a tool-calling turn (PLN-261012 SG-33). Deliberately a SEPARATE type from
 * `AiMessage`: widening `AiMessage.content` to `string | AiContentBlock[]` would break every
 * helper that treats a message's content as a string (conversation history, classifier, RAG), and
 * those never carry a tool turn. Only the tool loop builds `AiBlockMessage`s.
 */
export type AiContentBlock =
  | { type: 'text'; text: string }
  /** The model asking for a tool. `id` links it to the `tool_result` that answers it. */
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  /** Our answer to one `tool_use`. `isError` tells the model the call did not succeed. */
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface AiBlockMessage {
  /** Tool turns are always user (tool results) or assistant (text + tool uses). */
  role: 'user' | 'assistant';
  content: AiContentBlock[];
}

/** What the adapters accept: the classic string message, or a block message of a tool turn. */
export type AiRequestMessage = AiMessage | AiBlockMessage;

/** A tool the model may call: a name, what it does, and the JSON Schema of its single object argument. */
export interface AiToolDef {
  /** `^[a-zA-Z0-9_-]{1,64}$` — the intersection of what Anthropic and OpenAI accept. */
  name: string;
  description: string;
  /** JSON Schema, `type: 'object'` at the top (providers reject oneOf/anyOf there). */
  inputSchema: Record<string, unknown>;
}

/** One tool call the model made in a response. */
export interface AiToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /**
   * Set by an adapter when the provider's arguments could not be read as a JSON object (OpenAI sends
   * them as a string). The call must not be executed; the loop answers it with an error result.
   */
  inputError?: string;
}

/** Why the model stopped, in the two providers' common vocabulary. */
export type AiStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface AiCompletionRequest {
  system?: string;
  messages: AiRequestMessage[];
  temperature?: number;
  maxTokens?: number;
  model: string;
  apiKey?: string;
  endpoint?: string;
  /** Whole-call deadline in ms; adapters default to `AI_REQUEST_TIMEOUT_MS` (PLN-261012 SG-84). */
  timeoutMs?: number;
  /**
   * Tools the model may call (PLN-261012 SG-33). Absent or empty = a plain completion whose wire
   * format and result shape are exactly what they were before tools existed.
   */
  tools?: AiToolDef[];
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
  /**
   * Tool calls the model made (PLN-261012 SG-33). Only present on a response to a request that
   * carried `tools`, and only when the model asked for at least one.
   */
  toolUses?: AiToolUse[];
  /** Why generation stopped. Only present on a response to a request that carried `tools`. */
  stopReason?: AiStopReason;
  /**
   * The gateway refused to send a tools request to an engine that cannot use tools, so nothing was
   * sent and `text` is empty. Always accompanied by `degraded: true`.
   */
  toolsRefused?: boolean;
}

/** `string` content of any request message, with a tool turn's blocks flattened to readable text. */
export function messageText(content: string | AiContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((b) => (b.type === 'text' ? b.text : b.type === 'tool_use' ? `[tool_use ${b.name}]` : b.content))
    .join('\n');
}

/** Embedding request/response (KB vector retrieval — PLAN-KB-VectorHybrid-Qdrant). */
export interface AiEmbeddingRequest {
  texts: string[];
  /** Retrieval asymmetry hint: queries and documents embed differently. */
  inputType: 'query' | 'document';
  model?: string;
  apiKey?: string;
  /** Per-request deadline in ms; defaults to `EMBED_REQUEST_TIMEOUT_MS` (PLN-261012 SG-84). */
  timeoutMs?: number;
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
  /**
   * Whether this adapter can carry `tools` and tool turns (PLN-261012 SG-33). Absent = no: an
   * adapter that was written before tools existed must never be handed a tools request.
   */
  readonly supportsTools?: boolean;
  complete(req: AiCompletionRequest): Promise<AiCompletionResult>;
  /** Optional — only embedding-capable adapters (voyage, stub) implement this. */
  embed?(req: AiEmbeddingRequest): Promise<AiEmbeddingResult>;
}
