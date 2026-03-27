// Types matching the Claude Agent SDK message format

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Record<string, unknown>[] | null;
  is_error?: boolean;
  structuredContent?: Record<string, unknown>;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

export interface BaseMessage {
  id: string;
  timestamp: number;
  parentToolUseId?: string | null;
}

export interface UserMessage extends BaseMessage {
  type: 'user';
  content: string | ContentBlock[];
}

export interface AssistantMessage extends BaseMessage {
  type: 'assistant';
  content: ContentBlock[];
  model?: string;
  error?: {
    type: 'auth' | 'billing' | 'rate_limit' | 'unknown';
    message: string;
  };
}

export interface SystemMessage extends BaseMessage {
  type: 'system';
  content: string;
}

export interface ResultMessage extends BaseMessage {
  type: 'result';
  subtype: string;
  durationMs: number;
  durationApiMs: number;
  isError: boolean;
  numTurns: number;
  sessionId: string;
  totalCostUsd?: number;
  usage?: Record<string, unknown>;
  result?: string;
}

export type Message = UserMessage | AssistantMessage | SystemMessage | ResultMessage;

// Connection status
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// Agent state
export interface AgentState {
  isProcessing: boolean;
  currentActivity?: string;
  activeToolCalls: string[];
  currentSessionId?: string;
}

// Agent context metrics (tracked separately for main and subagent)
export interface AgentContextMetrics {
  input_tokens: number;
  output_tokens: number;
  context_utilization_pct: number;
}

// Usage metrics types - cost aggregated, context tracked per agent
export interface UsageMetrics {
  total_cost_usd: number;
  main_agent: AgentContextMetrics;
  subagent: AgentContextMetrics;
  turn_count: number;
}

// Session types
export interface Session {
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  num_turns: number;
  total_cost_usd?: number;
  is_complete: boolean;
}
