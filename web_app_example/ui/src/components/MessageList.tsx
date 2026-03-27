import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { FileText, Check, Loader2, AlertCircle, ArrowDown, Sparkles } from 'lucide-react';
import type { Message, ToolResultBlock, TextBlock, ToolUseBlock } from '../types';
import { MessageBubble } from './MessageBubble';
import { SubagentPanel } from './SubagentChain';
import type { SubagentChainGroup, TaskDispatch } from './SubagentChain';
import './MessageList.css';

interface StarterPrompt {
  title: string;
  prompt: string;
}

interface MessageListProps {
  messages: Message[];
  toolResults: Map<string, ToolResultBlock>;
  executingTools: Set<string>;
  isThinking?: boolean;
  isProcessing?: boolean;
  toolApps?: Record<string, string>;
  mcpAppAnswers?: Map<string, string>;
  starterPrompts?: StarterPrompt[];
  onStarterClick?: (prompt: string) => void;
}

type ExportStatus = 'idle' | 'exporting' | 'success' | 'error';

export function MessageList({
  messages,
  toolResults,
  executingTools,
  isThinking = false,
  isProcessing = false,
  toolApps = {},
  mcpAppAnswers,
  starterPrompts = [],
  onStarterClick,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Track if user is near bottom (should auto-scroll)
  const isNearBottomRef = useRef(true);
  const userHasScrolledUpRef = useRef(false); // Track if user manually scrolled up
  const isAutoScrollingRef = useRef(false); // Prevent scroll events during auto-scroll
  const prevMessageCountRef = useRef(0); // Track message count to detect session changes
  const lastScrollTopRef = useRef(0); // Track scroll position to detect user scrolling up
  const isResumingSessionRef = useRef(false); // Track if we're in the middle of resuming
  const SCROLL_THRESHOLD = 150; // pixels from bottom to consider "near bottom"

  // Check if user is near bottom of scroll container
  const checkIfNearBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    return distanceFromBottom < SCROLL_THRESHOLD;
  }, []);

  // Reset scroll state when messages are cleared (new/resumed session)
  useEffect(() => {
    // If messages went from many to few (or 0), we're likely resuming/switching sessions
    if (messages.length < prevMessageCountRef.current || messages.length === 0) {
      isResumingSessionRef.current = true;
      // Don't reset userHasScrolledUpRef here - we'll handle it after initial load
    }

    // If we were resuming and now have messages, mark resume complete after a brief delay
    // This allows the initial batch of messages to load without forcing scroll
    if (isResumingSessionRef.current && messages.length > 0) {
      // Give user a moment to see where they are before enabling auto-scroll
      const timer = setTimeout(() => {
        isResumingSessionRef.current = false;
        // Only reset scroll state if user is actually at the bottom
        if (checkIfNearBottom()) {
          userHasScrolledUpRef.current = false;
          isNearBottomRef.current = true;
          setShowScrollButton(false);
        }
      }, 100);
      return () => clearTimeout(timer);
    }

    prevMessageCountRef.current = messages.length;
  }, [messages.length, checkIfNearBottom]);

  // Handle scroll events to track user position
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const currentScrollTop = container.scrollTop;
      const scrolledUp = currentScrollTop < lastScrollTopRef.current - 5; // 5px threshold for noise

      // CRITICAL: Detect user scrolling UP even during auto-scroll animation
      // If scroll position decreased, user is actively trying to scroll up
      if (scrolledUp && isAutoScrollingRef.current) {
        // User is fighting the auto-scroll - respect their intent
        userHasScrolledUpRef.current = true;
        isAutoScrollingRef.current = false; // Cancel the auto-scroll
      }

      lastScrollTopRef.current = currentScrollTop;

      // Skip normal processing during auto-scroll (but we already caught upward scrolls above)
      if (isAutoScrollingRef.current) return;

      const nearBottom = checkIfNearBottom();
      isNearBottomRef.current = nearBottom;

      // If user scrolled away from bottom, mark it
      if (!nearBottom) {
        userHasScrolledUpRef.current = true;
      }
      // Only reset if user scrolled back to bottom themselves
      if (nearBottom && userHasScrolledUpRef.current) {
        userHasScrolledUpRef.current = false;
      }

      setShowScrollButton(!nearBottom);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [checkIfNearBottom]);

  // Auto-scroll to bottom only if user hasn't scrolled up
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Don't auto-scroll during session resume
    if (isResumingSessionRef.current) return;

    // Re-check position right now — refs may be stale from a previous animation
    if (userHasScrolledUpRef.current) return;

    const nearBottom = checkIfNearBottom();
    if (!nearBottom) return;

    isAutoScrollingRef.current = true;

    requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'instant',
      });
      isAutoScrollingRef.current = false;
    });
  }, [messages.length, isThinking, isProcessing, toolResults.size, executingTools.size, checkIfNearBottom]);

  // Scroll to bottom handler for button
  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    isAutoScrollingRef.current = true;
    isNearBottomRef.current = true;
    userHasScrolledUpRef.current = false;
    setShowScrollButton(false);

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth'
    });

    setTimeout(() => {
      isAutoScrollingRef.current = false;
    }, 500);
  }, []);

  // Extract final document content from messages
  const extractFinalDocument = (): { title: string; content: string } | null => {
    // Find all text content from assistant messages
    const textContents: string[] = [];

    for (const message of messages) {
      if (message.type === 'assistant' && Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === 'text' && (block as TextBlock).text) {
            textContents.push((block as TextBlock).text);
          }
        }
      }
    }

    if (textContents.length === 0) return null;

    // Use the last substantial text content as the document
    const lastContent = textContents[textContents.length - 1];

    // Extract title from the content (look for first heading or first line)
    const titleMatch = lastContent.match(/^#\s+(.+)$/m) ||
                       lastContent.match(/^\*\*(.+?)\*\*/m);
    const title = titleMatch
      ? titleMatch[1].replace(/[^\w\s-]/g, '').trim()
      : 'Agent Output';

    return { title, content: lastContent };
  };

  const handleExportToGoogleDocs = async () => {
    const doc = extractFinalDocument();
    if (!doc) {
      setExportError('No document content found to export');
      setExportStatus('error');
      return;
    }

    setExportStatus('exporting');
    setExportError(null);
    setExportedUrl(null);

    try {
      const response = await fetch('/api/export/google-docs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: doc.title,
          content: doc.content,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setExportedUrl(data.doc_url);
        setExportStatus('success');
      } else {
        setExportError(data.error || 'Failed to export to Google Docs');
        setExportStatus('error');
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export');
      setExportStatus('error');
    }
  };

  // Check if we should show the export button
  const hasResult = messages.some(m => m.type === 'result');
  const showExportButton = hasResult && !isProcessing && extractFinalDocument() !== null;

  // Group messages into render items:
  //  - 'message': a single main-agent message
  //  - 'panel':   all concurrent subagent chains displayed side-by-side
  //
  // Consecutive subagent messages (possibly from different parentToolUseIds
  // that interleave) are collected into a single panel.  A new main-agent
  // message flushes the panel.
  type RenderItem =
    | { kind: 'message'; message: Message }
    | { kind: 'panel'; chains: SubagentChainGroup[] };

  // Index every Task tool_use by its id so the subagent panel can show
  // the prompt each chain was given. Also lets us pre-seed empty chains
  // so the panel appears the instant Task fires, before any subagent
  // message has streamed back.
  const taskDispatches = useMemo(() => {
    const m = new Map<string, TaskDispatch>();
    for (const msg of messages) {
      if (msg.type !== 'assistant' || msg.parentToolUseId) continue;
      for (const block of msg.content) {
        if (block.type === 'tool_use' && (block as ToolUseBlock).name === 'Task') {
          const tu = block as ToolUseBlock;
          const input = tu.input as Record<string, unknown>;
          m.set(tu.id, {
            description: typeof input.description === 'string' ? input.description : undefined,
            prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
            subagentType: typeof input.subagent_type === 'string' ? input.subagent_type : undefined,
          });
        }
      }
    }
    return m;
  }, [messages]);

  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = [];

    // Accumulates chains for the current panel (keyed by parentToolUseId)
    let pendingChains = new Map<string, Message[]>();

    const flushPanel = () => {
      if (pendingChains.size > 0) {
        const chains: SubagentChainGroup[] = [];
        for (const [parentToolUseId, msgs] of pendingChains) {
          chains.push({ parentToolUseId, messages: msgs });
        }
        items.push({ kind: 'panel', chains });
        pendingChains = new Map();
      }
    };

    // An assistant message whose only non-thinking content is Task calls
    // is a "pure dispatch" — MessageBubble renders nothing for it, and
    // we must NOT let it flush the panel. Parallel subagents stream in
    // as one such message per Task; flushing between them would split
    // one logical panel into N single-column panels.
    const isPureDispatch = (msg: Message): boolean => {
      if (msg.type !== 'assistant') return false;
      let sawTask = false;
      for (const block of msg.content) {
        if (block.type === 'thinking') continue;
        if (block.type === 'tool_use' && (block as ToolUseBlock).name === 'Task') {
          sawTask = true;
          continue;
        }
        return false; // text, or a non-Task tool → not pure
      }
      return sawTask;
    };

    const seedTasks = (msg: Message) => {
      if (msg.type !== 'assistant') return;
      for (const block of msg.content) {
        if (block.type === 'tool_use' && (block as ToolUseBlock).name === 'Task') {
          const id = (block as ToolUseBlock).id;
          if (!pendingChains.has(id)) pendingChains.set(id, []);
        }
      }
    };

    for (const msg of messages) {
      const parentId = msg.parentToolUseId ?? null;

      if (parentId) {
        // Subagent message — add to the appropriate chain in the current panel
        const existing = pendingChains.get(parentId);
        if (existing) {
          existing.push(msg);
        } else {
          pendingChains.set(parentId, [msg]);
        }
      } else if (isPureDispatch(msg)) {
        // Just pre-seed — no flush, no message item. Consecutive pure
        // dispatches accumulate into the same panel.
        seedTasks(msg);
      } else {
        // Main agent message with visible content — closes any open panel.
        flushPanel();
        items.push({ kind: 'message', message: msg });
        // It may still carry Task calls alongside text (e.g. "I'll spawn
        // three investigators" + 3×Task). Open a panel for those next.
        seedTasks(msg);
      }
    }
    flushPanel();

    return items;
  }, [messages]);

  // Show the spark whenever the agent is working but nothing on screen
  // is visibly "live". If a tool is executing, its header spinner covers
  // it; if a subagent is running, the panel pulse covers it. The gap this
  // fills is pure reasoning time — before the first token, and between a
  // tool result landing and the next assistant output starting.
  const showInlineSpark = isProcessing && executingTools.size === 0;

  if (messages.length === 0 && !isProcessing) {
    return (
      <div className="message-list empty">
        <div className="empty-state">
          <div className="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h2 className="empty-title">Start a conversation</h2>
          <p className="empty-description">
            Enter a message below to begin your interaction with the Claude Agent.
          </p>
          <div className="empty-hints">
            <div className="hint">
              <span className="hint-key">Enter</span>
              <span className="hint-desc">Send message</span>
            </div>
            <div className="hint">
              <span className="hint-key">Shift+Enter</span>
              <span className="hint-desc">New line</span>
            </div>
          </div>
          {starterPrompts.length > 0 && (
            <div className="starter-prompts">
              <p className="starter-prompts-label">Try one of these to get started</p>
              {starterPrompts.map((sp, i) => (
                <button
                  key={i}
                  className="starter-prompt"
                  onClick={() => onStarterClick?.(sp.prompt)}
                >
                  <span className="starter-prompt-title">{sp.title}</span>
                  <span className="starter-prompt-text">{sp.prompt}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="message-list-container">
      <div className="message-list" ref={containerRef}>
        <div className="messages-wrapper">
          {renderItems.map((item, idx) =>
            item.kind === 'panel' ? (
              <SubagentPanel
                key={`panel-${idx}`}
                chains={item.chains}
                toolResults={toolResults}
                executingTools={executingTools}
                toolApps={toolApps}
                mcpAppAnswers={mcpAppAnswers}
                taskDispatches={taskDispatches}
              />
            ) : (
              <MessageBubble
                key={item.message.id}
                message={item.message}
                toolResults={toolResults}
                executingTools={executingTools}
                isSubagent={false}
                toolApps={toolApps}
                mcpAppAnswers={mcpAppAnswers}
              />
            )
          )}

          {showInlineSpark && (
            <div className="inline-processing">
              <Sparkles className="inline-processing-spark" size={18} aria-hidden="true" />
            </div>
          )}

          {showExportButton && (
            <div className="export-section">
              <button
                className={`export-button ${exportStatus}`}
                onClick={handleExportToGoogleDocs}
                disabled={exportStatus === 'exporting'}
              >
                {exportStatus === 'idle' && (
                  <>
                    <FileText size={16} />
                    <span>Save to Google Docs</span>
                  </>
                )}
                {exportStatus === 'exporting' && (
                  <>
                    <Loader2 size={16} className="spinner" />
                    <span>Exporting...</span>
                  </>
                )}
                {exportStatus === 'success' && (
                  <>
                    <Check size={16} />
                    <span>Saved!</span>
                  </>
                )}
                {exportStatus === 'error' && (
                  <>
                    <AlertCircle size={16} />
                    <span>Retry Export</span>
                  </>
                )}
              </button>
              {exportedUrl && (
                <a
                  href={exportedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="export-link"
                >
                  Open in Google Docs
                </a>
              )}
              {exportError && (
                <span className="export-error">{exportError}</span>
              )}
            </div>
          )}

        </div>
      </div>

      {showScrollButton && (
        <button
          className="scroll-to-bottom-btn"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
        >
          <ArrowDown size={18} />
        </button>
      )}
    </div>
  );
}

export default MessageList;
