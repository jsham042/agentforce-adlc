import { Clock, MessageSquare, DollarSign } from 'lucide-react';
import type { ConnectionStatus, AgentState, UsageMetrics } from '../types';
import type { SessionStats } from '../hooks/useAgentConnection';
import { UsageDisplay } from './UsageDisplay';
import './StatusBar.css';

interface StatusBarProps {
  connectionStatus: ConnectionStatus;
  agentState: AgentState;
  sessionStats?: SessionStats | null;
  usageMetrics?: UsageMetrics | null;
}

export function StatusBar({ agentState, sessionStats, usageMetrics }: StatusBarProps) {
  const hasContent = agentState.activeToolCalls.length > 0 || sessionStats || usageMetrics;

  if (!hasContent) return null;

  return (
    <div className="status-bar">
      <div className="status-left">
        {agentState.activeToolCalls.length > 0 && (
          <div className="active-tools">
            <span className="tools-label">Tools:</span>
            {agentState.activeToolCalls.map((tool) => (
              <span key={tool} className="tool-badge">{tool}</span>
            ))}
          </div>
        )}

        {agentState.isProcessing && usageMetrics && (
          <UsageDisplay usage={usageMetrics} />
        )}

        {sessionStats && !agentState.isProcessing && (
          <div className="session-stats">
            <div className="stat-item">
              <Clock size={12} />
              <span>{(sessionStats.durationMs / 1000).toFixed(1)}s</span>
            </div>
            <div className="stat-item">
              <MessageSquare size={12} />
              <span>{sessionStats.numTurns} turns</span>
            </div>
            {sessionStats.totalCostUsd !== undefined && (
              <div className="stat-item">
                <DollarSign size={12} />
                <span>${sessionStats.totalCostUsd.toFixed(4)}</span>
              </div>
            )}
          </div>
        )}

        {!agentState.isProcessing && !sessionStats && usageMetrics && (
          <UsageDisplay usage={usageMetrics} />
        )}
      </div>
    </div>
  );
}

export default StatusBar;
