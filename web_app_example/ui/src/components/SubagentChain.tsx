import { useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Bot,
  Search,
  CheckCircle,
} from 'lucide-react';
import type { Message, ToolUseBlock, ToolResultBlock } from '../types';
import { MessageBubble } from './MessageBubble';
import claudeSpark from '../../assets/Claude symbol - Ivory.svg';
import './SubagentChain.css';

/** Input the parent agent passed to the Task tool when spawning this chain. */
export interface TaskDispatch {
  description?: string;
  prompt?: string;
  subagentType?: string;
}

export interface SubagentChainGroup {
  parentToolUseId: string;
  messages: Message[];
}

/* ─── Chain stats ─── */

function getChainStatus(
  parentToolUseId: string,
  messages: Message[],
  executingTools: Set<string>,
): 'running' | 'complete' {
  // The parent Task tool_use itself is the authoritative signal — it stays
  // in executingTools until the subagent returns its final result.
  if (executingTools.has(parentToolUseId)) return 'running';
  // Pre-seeded chain (panel opened but no subagent reply yet).
  if (messages.length === 0) return 'running';
  for (const msg of messages) {
    if (msg.type === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          if (executingTools.has((block as ToolUseBlock).id)) return 'running';
        }
      }
    }
  }
  return 'complete';
}

function countToolCalls(messages: Message[]): number {
  let n = 0;
  for (const msg of messages) {
    if (msg.type === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') n++;
      }
    }
  }
  return n;
}

/**
 * Is any tool *this subagent* dispatched still running?
 *
 * When false while the chain is still 'running', the subagent is in model
 * inference (startup, thinking about a tool result, extended thinking) — the
 * same dead-air window the main stream covers with the inline spark, except
 * MessageList.tsx:354 keys off executingTools.size===0, and the Task ID keeps
 * that >0 for the whole subagent lifetime. So we scope the check to just this
 * chain's own tool IDs.
 */
function hasLiveChainTool(messages: Message[], executingTools: Set<string>): boolean {
  for (const msg of messages) {
    if (msg.type === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use' && executingTools.has((block as ToolUseBlock).id)) {
          return true;
        }
      }
    }
  }
  return false;
}

/* ─── Thread: one subagent's work, marked by a left rail ─── */
/*
 * The rail is the whole UI. No box, no background — the subagent's
 * messages sit directly on the canvas like the main agent's do, just
 * indented behind a 2px accent line. Tool calls keep their normal
 * contrast against --bg-primary.
 *
 * Running threads pulse the rail; complete threads go solid.
 */

interface SubagentThreadProps {
  chain: SubagentChainGroup;
  dispatch?: TaskDispatch;
  toolResults: Map<string, ToolResultBlock>;
  executingTools: Set<string>;
  toolApps?: Record<string, string>;
  mcpAppAnswers?: Map<string, string>;
}

function SubagentThread({ chain, dispatch, toolResults, executingTools, toolApps = {}, mcpAppAnswers }: SubagentThreadProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showPrompt, setShowPrompt] = useState(false);

  const { parentToolUseId, messages } = chain;
  const status = useMemo(
    () => getChainStatus(parentToolUseId, messages, executingTools),
    [parentToolUseId, messages, executingTools],
  );
  const toolCount = useMemo(() => countToolCalls(messages), [messages]);
  const showSpark = status === 'running' && !hasLiveChainTool(messages, executingTools);

  // "knowledge-management" → "Knowledge Management Subagent"
  const kind = dispatch?.subagentType
    ? `${dispatch.subagentType.replace(/[-_]/g, ' ')} Subagent`
    : 'Subagent';

  return (
    <div className={`subagent-thread ${status}`}>
      <button
        className="thread-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <span className="thread-chevron">
          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <Bot size={14} className="thread-bot" />
        <span className="thread-kind">{kind}</span>
        {dispatch?.description && <span className="thread-label">{dispatch.description}</span>}
        <span className="thread-meta">
          {toolCount > 0 && (
            <span className="thread-tool-count">
              <Search size={10} />
              {toolCount}
            </span>
          )}
          {status === 'running' ? (
            <span className="thread-status running">Running</span>
          ) : (
            <CheckCircle size={13} className="thread-status complete" />
          )}
        </span>
      </button>

      {isExpanded && (
        <div className="thread-body">
          {dispatch?.prompt && (
            <div className="thread-prompt">
              <button
                className="thread-prompt-toggle"
                onClick={() => setShowPrompt(!showPrompt)}
                aria-expanded={showPrompt}
              >
                {showPrompt ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                <span>Prompt</span>
              </button>
              {showPrompt && <pre className="thread-prompt-body">{dispatch.prompt}</pre>}
            </div>
          )}
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              toolResults={toolResults}
              executingTools={executingTools}
              isSubagent={true}
              toolApps={toolApps}
              mcpAppAnswers={mcpAppAnswers}
            />
          ))}
          {showSpark && (
            <div className="thread-inference">
              <img src={claudeSpark} alt="" className="thread-inference-spark" aria-hidden="true" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Panel: stacks one or more threads ─── */
/*
 * Single chain → render the thread bare.
 * Multiple chains → add a small "Subagents · N" group header above
 * the stack so the user can collapse all parallel work at once.
 * No side-by-side columns — threads read better stacked, and each
 * one already collapses independently.
 */

interface SubagentPanelProps {
  chains: SubagentChainGroup[];
  toolResults: Map<string, ToolResultBlock>;
  executingTools: Set<string>;
  toolApps?: Record<string, string>;
  mcpAppAnswers?: Map<string, string>;
  taskDispatches?: Map<string, TaskDispatch>;
}

export function SubagentPanel({ chains, toolResults, executingTools, toolApps = {}, mcpAppAnswers, taskDispatches }: SubagentPanelProps) {
  const [isGroupExpanded, setIsGroupExpanded] = useState(true);

  const threads = chains.map((chain) => (
    <SubagentThread
      key={chain.parentToolUseId}
      chain={chain}
      dispatch={taskDispatches?.get(chain.parentToolUseId)}
      toolResults={toolResults}
      executingTools={executingTools}
      toolApps={toolApps}
      mcpAppAnswers={mcpAppAnswers}
    />
  ));

  if (chains.length === 1) {
    return <>{threads}</>;
  }

  return (
    <div className="subagent-group">
      <button
        className="group-header"
        onClick={() => setIsGroupExpanded(!isGroupExpanded)}
        aria-expanded={isGroupExpanded}
      >
        <span className="thread-chevron">
          {isGroupExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className="group-title">Subagents</span>
      </button>
      {isGroupExpanded && <div className="group-body">{threads}</div>}
    </div>
  );
}

export default SubagentPanel;
