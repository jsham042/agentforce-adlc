import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Trash2, MessageSquare, Clock } from 'lucide-react';
import type { Session } from '../types';
import './SessionList.css';

interface SessionListProps {
  onSelectSession: (sessionId: string) => void;
  onSessionsLoaded?: (count: number) => void;
  currentSessionId?: string;
}

export interface SessionListRef {
  refresh: () => void;
}

export const SessionList = forwardRef<SessionListRef, SessionListProps>(function SessionList(
  { onSelectSession, onSessionsLoaded, currentSessionId },
  ref
) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/sessions');
      if (!response.ok) throw new Error('Failed to fetch sessions');
      const data = await response.json();
      const list = data.sessions || [];
      setSessions(list);
      onSessionsLoaded?.(list.length);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Expose refresh method via ref for parent components
  useImperativeHandle(ref, () => ({
    refresh: fetchSessions,
  }), [fetchSessions]);

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      }
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return <div className="session-list"><div className="session-list-loading">Loading...</div></div>;
  }
  if (error) {
    return <div className="session-list"><div className="session-list-error">{error}</div></div>;
  }
  if (sessions.length === 0) {
    return <div className="session-list"><div className="session-list-empty">No saved sessions</div></div>;
  }

  return (
    <div className="session-list">
      <div className="session-list-items">
        {sessions.map((session) => (
          <div
            key={session.session_id}
            className={`session-item ${session.session_id === currentSessionId ? 'active' : ''}`}
            onClick={() => onSelectSession(session.session_id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectSession(session.session_id);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="session-item-title">{session.title || session.session_id}</div>
            <div className="session-item-meta">
              {session.updated_at && (
                <span className="session-meta-item">
                  <Clock size={12} />
                  {formatDate(session.updated_at)}
                </span>
              )}
              {session.num_turns !== undefined && (
                <span className="session-meta-item">
                  <MessageSquare size={12} />
                  {session.num_turns} turns
                </span>
              )}
            </div>
            <button
              className="session-delete-btn"
              onClick={(e) => deleteSession(session.session_id, e)}
              title="Delete session"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
});

export default SessionList;
