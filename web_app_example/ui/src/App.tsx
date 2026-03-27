import { useState, useEffect, useRef, useCallback } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Bot } from 'lucide-react';
import { MessageList, ChatInput, StatusBar, TodoList, Artifacts } from './components';
import { SessionList } from './components/SessionList';
import type { SessionListRef } from './components/SessionList';
import { useAgentConnection } from './hooks/useAgentConnection';
import './App.css';

function AgentChat() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sessionListRef = useRef<SessionListRef>(null);
  const [agentName, setAgentName] = useState('Agent');
  const [sessionCount, setSessionCount] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [starterPrompts, setStarterPrompts] = useState<{ title: string; prompt: string }[]>([]);

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(cfg => {
        if (cfg.agent_name) setAgentName(cfg.agent_name);
        if (cfg.starter_prompts) setStarterPrompts(cfg.starter_prompts);
      })
      .catch(() => {});
  }, []);

  const {
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
    sendMessage,
    resumeSession,
    recordMcpAppAnswer,
    clearMessages,
    toolApps,
  } = useAgentConnection({
    autoConnect: true,
  });

  // Refresh session list when title is updated
  useEffect(() => {
    if (currentSessionTitle) {
      sessionListRef.current?.refresh();
    }
  }, [currentSessionTitle]);

  const isThinking = agentState.isProcessing && agentState.currentActivity === 'Thinking...';
  const isDisabled = connectionStatus !== 'connected' || agentState.isProcessing;

  const handleSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    // Load the session's messages from the backend
    resumeSession(sessionId);
  };

  const handleNewSession = () => {
    setSelectedSessionId(undefined);
    clearMessages();
  };

  const handleRefreshSessions = async () => {
    setIsRefreshing(true);
    await sessionListRef.current?.refresh();
    setIsRefreshing(false);
  };

  const uploadFiles = async (sid: string, files: File[]): Promise<string[]> => {
    const landed: string[] = [];
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch(`/api/sessions/${sid}/upload`, { method: 'POST', body: form });
      if (r.ok) landed.push(file.name);
    }
    return landed;
  };

  const handleSendMessage = useCallback(async (content: string, stagedFiles: File[]) => {
    if (stagedFiles.length > 0) {
      // First-message-with-attachments path. We don't have a session yet
      // (if we did, ChatInput would have uploaded immediately instead of
      // staging). Create one, push the files, then send — atomically from
      // the user's perspective. Pass sid directly to sendMessage; don't
      // rely on setSelectedSessionId landing before the send fires.
      const res = await fetch('/api/sessions', { method: 'POST' });
      const { session_id: sid } = await res.json();
      await uploadFiles(sid, stagedFiles);
      sessionListRef.current?.refresh();
      sendMessage(content, sid);
    } else {
      sendMessage(content, selectedSessionId);
    }
    setSelectedSessionId(undefined);
  }, [sendMessage, selectedSessionId]);

  // Mid-session only — ChatInput gates this on sessionActive, so sid is
  // guaranteed to exist here.
  const handleAttach = useCallback(async (files: FileList): Promise<string[]> => {
    const sid = currentSessionId || selectedSessionId;
    if (!sid) return [];
    return uploadFiles(sid, Array.from(files));
  }, [currentSessionId, selectedSessionId]);

  // Listen for MCP App user responses (e.g., clarification form submissions).
  // The form renders as soon as the tool result arrives — mid-turn, before the
  // agent finishes. If the user submits while isProcessing is still true, we
  // queue the response and flush it when the turn ends, rather than dropping it.
  const pendingMcpResponse = useRef<{ text: string; toolUseId?: string } | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const { text, toolUseId } = (e as CustomEvent).detail ?? {};
      if (!text || connectionStatus !== 'connected') return;
      if (toolUseId) recordMcpAppAnswer(toolUseId, text);
      if (agentState.isProcessing) {
        pendingMcpResponse.current = { text, toolUseId };
      } else {
        handleSendMessage(text, []);
      }
    };
    document.addEventListener('mcp-app-user-response', handler);
    return () => document.removeEventListener('mcp-app-user-response', handler);
  }, [handleSendMessage, agentState.isProcessing, connectionStatus, recordMcpAppAnswer]);

  useEffect(() => {
    if (!agentState.isProcessing && pendingMcpResponse.current) {
      const { text } = pendingMcpResponse.current;
      pendingMcpResponse.current = null;
      handleSendMessage(text, []);
    }
  }, [agentState.isProcessing, handleSendMessage]);

  return (
    <div className="app">
      <div className="app-body">
        <div className={`sidebar-container ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-brand">
            <Bot className="sidebar-brand-mark" size={20} aria-hidden="true" />
            <div className="sidebar-brand-text">
              <div className="sidebar-brand-title">{agentName}</div>
              <div className="sidebar-brand-subtitle">Powered by Claude Agent SDK</div>
            </div>
            <button
              className="sidebar-icon-btn"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? 'Expand sessions' : 'Collapse sessions'}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>
          <div className="sidebar-header-row">
            <span className="sidebar-title">
              Sessions{sessionCount > 0 && ` (${sessionCount})`}
            </span>
            <button
              className="sidebar-icon-btn"
              onClick={handleRefreshSessions}
              disabled={isRefreshing}
              title="Refresh sessions"
            >
              <RefreshCw size={14} className={isRefreshing ? 'spinning' : ''} />
            </button>
          </div>
          <button className="sidebar-new-chat" onClick={handleNewSession}>
            <span className="sidebar-new-chat-icon"><Plus size={14} /></span>
            <span>New chat</span>
          </button>
          <aside className="sidebar sidebar-left">
            <SessionList
              ref={sessionListRef}
              onSelectSession={handleSelectSession}
              onSessionsLoaded={setSessionCount}
              currentSessionId={currentSessionId || selectedSessionId}
            />
          </aside>
        </div>
        <div className="main-panel">
          {messages.length > 0 && (
            <div className="chat-header">
              <span className="chat-header-title">
                {currentSessionTitle || 'Untitled'}
              </span>
              {sessionStats && (
                <span className="chat-header-meta">
                  {sessionStats.numTurns} turns
                  {sessionStats.totalCostUsd !== undefined && ` · $${sessionStats.totalCostUsd.toFixed(4)}`}
                </span>
              )}
            </div>
          )}
          <StatusBar
            connectionStatus={connectionStatus}
            agentState={agentState}
            sessionStats={sessionStats}
          />
          <main className="main-content">
            {selectedSessionId && messages.length === 0 && (
              <div className="resume-session-hint">
                Resuming session. Type a message to continue the conversation.
              </div>
            )}
            <MessageList
              messages={messages}
              toolResults={toolResults}
              executingTools={executingTools}
              isThinking={isThinking}
              isProcessing={agentState.isProcessing}
              toolApps={toolApps}
              mcpAppAnswers={mcpAppAnswers}
              starterPrompts={starterPrompts}
              onStarterClick={(prompt) => handleSendMessage(prompt, [])}
            />
          </main>
          <ChatInput
            onSend={handleSendMessage}
            onAttach={handleAttach}
            sessionActive={!!(currentSessionId || selectedSessionId)}
            disabled={isDisabled}
            placeholder={
              connectionStatus !== 'connected'
                ? 'Connecting to agent...'
                : agentState.isProcessing
                ? 'Agent is processing...'
                : selectedSessionId
                ? 'Continue this session...'
                : 'Send a message...'
            }
          />
        </div>
        <aside className="sidebar sidebar-right">
          <TodoList agentTodos={agentTodos} />
          <Artifacts sessionId={currentSessionId || selectedSessionId} />
        </aside>
      </div>
    </div>
  );
}

function App() {
  return <AgentChat />;
}

export default App;
