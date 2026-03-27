import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Check, X, Loader2, ChevronsUpDown } from 'lucide-react';
import type { ToolUseBlock, ToolResultBlock } from '../types';
import { ToolCallBlock } from './ToolCallBlock';
import './ToolCallGroup.css';

interface ToolCallGroupProps {
  toolUses: ToolUseBlock[];
  toolResults: Map<string, ToolResultBlock>;
  executingTools: Set<string>;
  toolApps?: Record<string, string>;
  mcpAppAnswers?: Map<string, string>;
}

interface ToolStatus {
  executing: number;
  success: number;
  error: number;
  pending: number;
}

export function ToolCallGroup({ toolUses, toolResults, executingTools, toolApps = {}, mcpAppAnswers }: ToolCallGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // If there's only 1 tool, just render it directly
  if (toolUses.length === 1) {
    return (
      <ToolCallBlock
        toolUse={toolUses[0]}
        toolResult={toolResults.get(toolUses[0].id)}
        isExecuting={executingTools.has(toolUses[0].id)}
        toolApps={toolApps}
        mcpAppAnswers={mcpAppAnswers}
      />
    );
  }

  const status = useMemo<ToolStatus>(() => {
    return toolUses.reduce(
      (acc, tool) => {
        if (executingTools.has(tool.id)) {
          acc.executing++;
        } else if (toolResults.has(tool.id)) {
          if (toolResults.get(tool.id)?.is_error) {
            acc.error++;
          } else {
            acc.success++;
          }
        } else {
          acc.pending++;
        }
        return acc;
      },
      { executing: 0, success: 0, error: 0, pending: 0 }
    );
  }, [toolUses, toolResults, executingTools]);

  const getOverallStatus = (): 'executing' | 'success' | 'error' | 'pending' => {
    if (status.executing > 0) return 'executing';
    if (status.error > 0) return 'error';
    if (status.pending > 0) return 'pending';
    return 'success';
  };

  const getStatusSummary = (): string => {
    const parts: string[] = [];
    if (status.executing > 0) parts.push(`${status.executing} running`);
    if (status.success > 0) parts.push(`${status.success} done`);
    if (status.error > 0) parts.push(`${status.error} failed`);
    if (status.pending > 0) parts.push(`${status.pending} pending`);
    return parts.join(', ');
  };

  const getToolNames = (): string => {
    const names = toolUses.map(t => t.name);
    const uniqueNames = [...new Set(names)];
    if (uniqueNames.length <= 3) {
      return uniqueNames.join(', ');
    }
    return `${uniqueNames.slice(0, 2).join(', ')} +${uniqueNames.length - 2} more`;
  };

  const overallStatus = getOverallStatus();

  return (
    <div className={`tool-call-group ${overallStatus}`}>
      <button
        className="tool-group-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <span className="status-indicator">
          {overallStatus === 'executing' && <Loader2 size={14} className="status-icon executing" />}
          {overallStatus === 'success'   && <Check   size={14} className="status-icon success" />}
          {overallStatus === 'error'     && <X       size={14} className="status-icon error" />}
          {overallStatus === 'pending'   && <Loader2 size={14} className="status-icon pending" />}
        </span>
        <ChevronsUpDown className="group-icon" size={14} />
        <span className="tool-count">{toolUses.length} tools</span>
        <span className="tool-names">{getToolNames()}</span>
        <span className="status-summary">
          {status.executing > 0 && (
            <span className="status-badge executing">
              <Loader2 size={12} className="spinning" />
              {status.executing}
            </span>
          )}
          {status.success > 0 && (
            <span className="status-badge success">
              <Check size={12} />
              {status.success}
            </span>
          )}
          {status.error > 0 && (
            <span className="status-badge error">
              <X size={12} />
              {status.error}
            </span>
          )}
          {status.pending > 0 && (
            <span className="status-badge pending">
              <Loader2 size={12} />
              {status.pending}
            </span>
          )}
        </span>
        <span className="expand-icon">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {isExpanded && (
        <div className="tool-group-content">
          {toolUses.map((toolUse, index) => (
            <ToolCallBlock
              key={toolUse.id || index}
              toolUse={toolUse}
              toolResult={toolResults.get(toolUse.id)}
              isExecuting={executingTools.has(toolUse.id)}
              toolApps={toolApps}
              mcpAppAnswers={mcpAppAnswers}
            />
          ))}
        </div>
      )}

      {!isExpanded && status.executing > 0 && (
        <div className="tool-group-progress">
          <div className="progress-text">
            <Loader2 size={12} className="spinning" />
            <span>{getStatusSummary()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default ToolCallGroup;
