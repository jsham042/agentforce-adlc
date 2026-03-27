import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  Message,
  UserMessage,
  AssistantMessage,
  SystemMessage,
  ToolResultBlock,
  ConnectionStatus,
  AgentState,
  ContentBlock,
  UsageMetrics,
} from '../types';
import type { TodoItem, AgentTodos } from '../components/TodoList';

interface UseAgentConnectionOptions {
  url?: string;
  autoConnect?: boolean;
}

export interface SessionStats {
  durationMs: number;
  numTurns: number;
  totalCostUsd?: number;
  isError: boolean;
}

interface UseAgentConnectionReturn {
  messages: Message[];
  agentTodos: Record<string, AgentTodos>;
  toolResults: Map<string, ToolResultBlock>;
  executingTools: Set<string>;
  mcpAppAnswers: Map<string, string>;
  connectionStatus: ConnectionStatus;
  agentState: AgentState;
  currentSessionId: string | undefined;
  currentSessionTitle: string | undefined;
  sessionStats: SessionStats | null;
  usageMetrics: UsageMetrics | null;
  toolApps: Record<string, string>;
  sendMessage: (content: string, resumeSessionId?: string) => void;
  resumeSession: (sessionId: string) => void;
  recordMcpAppAnswer: (toolUseId: string, answer: string) => void;
  connect: () => void;
  disconnect: () => void;
  clearMessages: () => void;
}

// Generate unique IDs for messages
let messageIdCounter = 0;
const generateMessageId = () => `msg_${Date.now()}_${++messageIdCounter}`;

export function useAgentConnection(
  options: UseAgentConnectionOptions = {}
): UseAgentConnectionReturn {
  // Use relative WebSocket URL - works with Vite proxy in dev and direct in prod
  const defaultWsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
  const { url = defaultWsUrl, autoConnect = true } = options;

  const [messages, setMessages] = useState<Message[]>([]);
  const [agentTodos, setAgentTodos] = useState<Record<string, AgentTodos>>({});
  const [toolResults, setToolResults] = useState<Map<string, ToolResultBlock>>(new Map());
  const [executingTools, setExecutingTools] = useState<Set<string>>(new Set());
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string | undefined>();
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);
  const [agentState, setAgentState] = useState<AgentState>({
    isProcessing: false,
    activeToolCalls: [],
  });
  const [usageMetrics, setUsageMetrics] = useState<UsageMetrics | null>(null);
  const [toolApps, setToolApps] = useState<Record<string, string>>({});
  // tool_use_id → answer text. Tracks which MCP App forms have been submitted
  // so they render in the answered state on rehydration instead of re-prompting.
  const [mcpAppAnswers, setMcpAppAnswers] = useState<Map<string, string>>(new Map());

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  // Ref mirror of currentSessionId so the WS onopen callback can read the
  // latest value without a stale closure.
  const currentSessionIdRef = useRef<string | undefined>(undefined);
  currentSessionIdRef.current = currentSessionId;

  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const processIncomingMessage = useCallback((data: unknown) => {
    // Handle different message types from the backend
    const msg = data as Record<string, unknown>;

    switch (msg.type) {
      case 'assistant': {
        const content = msg.content as ContentBlock[];

        // Check for tool uses and mark them as executing
        const toolUses = content.filter((b): b is ContentBlock & { type: 'tool_use' } => b.type === 'tool_use');
        if (toolUses.length > 0) {
          setExecutingTools((prev) => {
            const next = new Set(prev);
            toolUses.forEach((t) => next.add(t.id));
            return next;
          });
          setAgentState((prev) => ({
            ...prev,
            isProcessing: true,
            activeToolCalls: toolUses.map((t) => t.name),
          }));
        }

        // Check for thinking blocks
        const hasThinking = content.some((b) => b.type === 'thinking');
        if (hasThinking) {
          setAgentState((prev) => ({
            ...prev,
            isProcessing: true,
            currentActivity: 'Thinking...',
          }));
        }

        const assistantMsg: AssistantMessage = {
          id: generateMessageId(),
          type: 'assistant',
          timestamp: Date.now(),
          content: content,
          model: msg.model as string | undefined,
          parentToolUseId: msg.parent_tool_use_id as string | undefined,
        };
        addMessage(assistantMsg);
        break;
      }

      case 'user': {
        // Tool results come as user messages
        const content = msg.content as ContentBlock[] | string;

        if (Array.isArray(content)) {
          // Process tool results
          content.forEach((block) => {
            if (block.type === 'tool_result') {
              const resultBlock = block as ToolResultBlock;
              setToolResults((prev) => {
                const next = new Map(prev);
                next.set(resultBlock.tool_use_id, resultBlock);
                return next;
              });
              setExecutingTools((prev) => {
                const next = new Set(prev);
                next.delete(resultBlock.tool_use_id);
                return next;
              });
            }
          });
        }

        const userMsg: UserMessage = {
          id: generateMessageId(),
          type: 'user',
          timestamp: Date.now(),
          content: content,
          parentToolUseId: msg.parent_tool_use_id as string | undefined,
        };

        // Only add if it's not just tool results (those are shown inline)
        if (typeof content === 'string') {
          addMessage(userMsg);
        }
        break;
      }

      case 'system': {
        const systemMsg: SystemMessage = {
          id: generateMessageId(),
          type: 'system',
          timestamp: Date.now(),
          content: msg.content as string,
        };
        addMessage(systemMsg);
        break;
      }

      case 'result': {
        setAgentState({
          isProcessing: false,
          activeToolCalls: [],
        });
        setExecutingTools(new Set());

        // Store session stats instead of adding a message
        setSessionStats({
          durationMs: msg.duration_ms as number,
          numTurns: msg.num_turns as number,
          totalCostUsd: msg.total_cost_usd as number | undefined,
          isError: msg.is_error as boolean,
        });
        break;
      }

      case 'error': {
        setAgentState({
          isProcessing: false,
          activeToolCalls: [],
        });
        const systemMsg: SystemMessage = {
          id: generateMessageId(),
          type: 'system',
          timestamp: Date.now(),
          content: `Error: ${msg.message || 'Unknown error'}`,
        };
        addMessage(systemMsg);
        break;
      }

      case 'todo_update': {
        const todoList = msg.todos as TodoItem[];
        const agentId = msg.agent_id as string;
        const agentName = msg.agent_name as string;
        const task = msg.task as string | undefined;
        setAgentTodos((prev) => ({
          ...prev,
          [agentId]: {
            agentId,
            agentName,
            task,
            todos: todoList,
          },
        }));
        break;
      }

      case 'session_saved': {
        const sessionId = msg.session_id as string;
        setCurrentSessionId(sessionId);
        setAgentState((prev) => ({
          ...prev,
          currentSessionId: sessionId,
        }));
        break;
      }

      case 'session_restored': {
        const sessionId = msg.session_id as string;
        const isProcessing = Boolean(msg.is_processing);
        setCurrentSessionId(sessionId);

        const restoredMessages = msg.messages as Array<Record<string, unknown>> | undefined;
        if (!restoredMessages) {
          setAgentState((prev) => ({ ...prev, currentSessionId: sessionId, isProcessing, activeToolCalls: [] }));
          break;
        }

        // Extract tool results from user messages for the toolResults map
        const restoredToolResults = new Map<string, ToolResultBlock>();
        restoredMessages.forEach((m) => {
          if (m.type === 'user') {
            const content = m.content;
            if (Array.isArray(content)) {
              content.forEach((block) => {
                if (typeof block === 'object' && block !== null && (block as Record<string, unknown>).type === 'tool_result') {
                  const resultBlock = block as ToolResultBlock;
                  restoredToolResults.set(resultBlock.tool_use_id, resultBlock);
                }
              });
            }
          }
        });

        // Rebuild executingTools: every tool_use id that doesn't yet have a
        // result. On reattach-while-processing this drives the spinners and
        // the SubagentPanel "Running" badge.
        const inFlight = new Set<string>();
        restoredMessages.forEach((m) => {
          if (m.type === 'assistant' && Array.isArray(m.content)) {
            (m.content as Array<Record<string, unknown>>).forEach((block) => {
              if (block.type === 'tool_use') {
                const id = block.id as string;
                if (!restoredToolResults.has(id)) inFlight.add(id);
              }
            });
          }
        });

        // Convert restored messages to our Message format, filtering out non-displayable types
        // User messages with array content (tool results) are skipped - results shown inline with tool_use
        const convertedMessages: Message[] = restoredMessages
          .filter((m) => {
            if (m.type === 'assistant') return true;
            if (m.type === 'user') {
              // Only include user messages with string content (actual user input)
              // Skip tool result messages (array content) - they're shown inline with tool_use
              return typeof m.content === 'string';
            }
            return false;
          })
          .map((m, index) => {
            const timestamp = (m.timestamp as number) || Date.now();
            const id = `restored_${sessionId}_${index}`;

            if (m.type === 'user') {
              return {
                id,
                type: 'user',
                timestamp,
                content: m.content as string,
                parentToolUseId: m.parent_tool_use_id as string | undefined,
              } as UserMessage;
            } else {
              // WS wire format: {type: 'assistant', content: [...], model, parent_tool_use_id}
              return {
                id,
                type: 'assistant',
                timestamp,
                content: m.content as ContentBlock[],
                model: m.model as string | undefined,
                parentToolUseId: m.parent_tool_use_id as string | undefined,
              } as AssistantMessage;
            }
          });

        // Replay todo_update messages to restore the task list
        const restoredTodos: Record<string, AgentTodos> = {};
        restoredMessages.forEach((m) => {
          if (m.type === 'todo_update') {
            const agentId = m.agent_id as string;
            restoredTodos[agentId] = {
              agentId,
              agentName: m.agent_name as string,
              task: m.task as string | undefined,
              todos: m.todos as TodoItem[],
            };
          }
        });

        // Rebuild MCP App answer map: for each tool_use, the next user-string
        // message in the stream is the answer. Populated for ALL tool_uses —
        // entries for non-MCP-App tools are simply never read (avoids a race
        // on toolApps, which is fetched async on WS open).
        const restoredAnswers = new Map<string, string>();
        restoredMessages.forEach((m, i) => {
          if (m.type !== 'assistant' || !Array.isArray(m.content)) return;
          (m.content as Array<Record<string, unknown>>).forEach((block) => {
            if (block.type !== 'tool_use') return;
            for (let j = i + 1; j < restoredMessages.length; j++) {
              const nxt = restoredMessages[j];
              if (nxt.type === 'user' && typeof nxt.content === 'string') {
                restoredAnswers.set(block.id as string, nxt.content);
                break;
              }
            }
          });
        });

        setMessages(convertedMessages);
        setToolResults(restoredToolResults);
        setExecutingTools(inFlight);
        setMcpAppAnswers(restoredAnswers);
        setAgentTodos(restoredTodos);
        setAgentState((prev) => ({
          ...prev,
          currentSessionId: sessionId,
          isProcessing,
          activeToolCalls: [],
        }));
        break;
      }

      case 'session_title_updated': {
        // Update session title when LLM generates it
        const title = msg.title as string;
        setCurrentSessionTitle(title);
        break;
      }

      case 'usage_updated': {
        // Update running usage metrics (pass through directly - matches UsageMetrics type)
        const usage = msg.usage as UsageMetrics;
        if (usage) {
          setUsageMetrics(usage);
        }
        break;
      }
    }
  }, [addMessage]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionStatus('connecting');

    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setConnectionStatus('connected');
        console.log('WebSocket connected');
        // Fetch MCP App registry — tool name → resource URI mapping
        fetch('/api/mcp/tool-apps')
          .then((r) => r.json())
          .then((d) => setToolApps(d.tool_apps || {}))
          .catch(() => setToolApps({}));

        // Re-attach to the server-side AgentSession we were viewing before
        // the disconnect. Server replies with session_restored carrying
        // is_processing, so the input disabled state corrects itself.
        const sid = currentSessionIdRef.current;
        if (sid) {
          ws.send(JSON.stringify({ type: 'resume', session_id: sid }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          processIncomingMessage(data);
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus('error');
      };

      ws.onclose = () => {
        setConnectionStatus('disconnected');
        console.log('WebSocket disconnected');

        // Clear transient state; auto-reconnect → resume → session_restored
        // will set the real isProcessing/executingTools from server truth.
        setAgentState({ isProcessing: false, activeToolCalls: [] });
        setExecutingTools(new Set());

        // Attempt to reconnect after a delay
        if (autoConnect) {
          reconnectTimeoutRef.current = window.setTimeout(() => {
            connect();
          }, 3000);
        }
      };

      wsRef.current = ws;
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      setConnectionStatus('error');
    }
  }, [url, autoConnect, processIncomingMessage]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const sendMessage = useCallback((content: string, resumeSessionId?: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      console.error('WebSocket is not connected');
      return;
    }

    // Add user message to the list
    const userMsg: UserMessage = {
      id: generateMessageId(),
      type: 'user',
      timestamp: Date.now(),
      content: content,
    };
    addMessage(userMsg);

    // Set processing state
    setAgentState({
      isProcessing: true,
      currentActivity: 'Processing...',
      activeToolCalls: [],
      currentSessionId: resumeSessionId || currentSessionId,
    });

    const sid = resumeSessionId || currentSessionId;
    const payload: Record<string, unknown> = {
      type: 'query',
      content: content,
    };
    if (sid) {
      payload.session_id = sid;
    }
    wsRef.current.send(JSON.stringify(payload));
  }, [addMessage, currentSessionId]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setAgentTodos({});
    setToolResults(new Map());
    setExecutingTools(new Set());
    setMcpAppAnswers(new Map());
    setCurrentSessionId(undefined);
    setCurrentSessionTitle(undefined);
    setSessionStats(null);
    setUsageMetrics(null);
  }, []);

  const recordMcpAppAnswer = useCallback((toolUseId: string, answer: string) => {
    setMcpAppAnswers((prev) => {
      const next = new Map(prev);
      next.set(toolUseId, answer);
      return next;
    });
  }, []);

  const resumeSession = useCallback((sessionId: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      console.error('WebSocket is not connected');
      return;
    }

    // Clear current messages before loading
    setMessages([]);
    setAgentTodos({});
    setToolResults(new Map());
    setExecutingTools(new Set());
    setMcpAppAnswers(new Map());
    setSessionStats(null);
    setUsageMetrics(null);

    // Send resume request to backend
    wsRef.current.send(JSON.stringify({
      type: 'resume',
      session_id: sessionId,
    }));
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    messages,
    agentTodos,
    toolResults,
    executingTools,
    mcpAppAnswers,
    connectionStatus,
    agentState,
    currentSessionId,
    currentSessionTitle,
    sessionStats,
    usageMetrics,
    toolApps,
    sendMessage,
    resumeSession,
    recordMcpAppAnswer,
    connect,
    disconnect,
    clearMessages,
  };
}

export default useAgentConnection;
