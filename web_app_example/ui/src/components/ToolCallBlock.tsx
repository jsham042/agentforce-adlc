import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench, Check, X, Loader2, Code, FileJson } from 'lucide-react';
import type { ToolUseBlock, ToolResultBlock } from '../types';
import { McpAppFrame } from './McpAppFrame';
import './ToolCallBlock.css';

interface ToolCallBlockProps {
  toolUse: ToolUseBlock;
  toolResult?: ToolResultBlock;
  isExecuting?: boolean;
  toolApps?: Record<string, string>;
  mcpAppAnswers?: Map<string, string>;
}

export function ToolCallBlock({ toolUse, toolResult, isExecuting = false, toolApps = {}, mcpAppAnswers }: ToolCallBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFormatted, setIsFormatted] = useState(true);

  const getStatusIcon = () => {
    if (isExecuting) {
      return <Loader2 className="status-icon executing" size={14} />;
    }
    if (toolResult) {
      return toolResult.is_error ? (
        <X className="status-icon error" size={14} />
      ) : (
        <Check className="status-icon success" size={14} />
      );
    }
    return <Loader2 className="status-icon pending" size={14} />;
  };

  const getStatusClass = () => {
    if (isExecuting) return 'executing';
    if (toolResult?.is_error) return 'error';
    if (toolResult) return 'success';
    return 'pending';
  };

  // Format value for human-readable display (no JSON syntax)
  const formatValueReadable = (value: unknown, indent: number = 0): string => {
    const spaces = '  '.repeat(indent);

    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return '(empty list)';
      return value.map((item, i) => {
        const itemStr = formatValueReadable(item, indent + 1);
        return `${spaces}  ${i + 1}. ${itemStr}`;
      }).join('\n');
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length === 0) return '(empty)';
      return entries.map(([k, v]) => {
        const valStr = formatValueReadable(v, indent + 1);
        // If value is multiline, put it on next line
        if (valStr.includes('\n')) {
          return `${spaces}${k}:\n${valStr}`;
        }
        return `${spaces}${k}: ${valStr}`;
      }).join('\n');
    }
    return String(value);
  };

  // Formatted = human-readable, Raw = pretty-printed JSON
  const formatInput = (input: Record<string, unknown>, formatted: boolean): string => {
    if (formatted) {
      // Human-readable format (no JSON syntax)
      const entries = Object.entries(input);
      if (entries.length === 0) return '(no input)';
      return entries.map(([key, value]) => {
        const valStr = formatValueReadable(value, 1);
        if (valStr.includes('\n')) {
          return `${key}:\n${valStr}`;
        }
        return `${key}: ${valStr}`;
      }).join('\n');
    }
    // Raw = pretty-printed JSON
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  };

  // Extract text from MCP-style content array
  const extractMcpText = (content: Record<string, unknown>[]): string | null => {
    const textParts: string[] = [];
    for (const item of content) {
      if (item && typeof item === 'object' && 'type' in item && item.type === 'text' && 'text' in item) {
        textParts.push(String(item.text));
      }
    }
    return textParts.length > 0 ? textParts.join('\n') : null;
  };

  const formatOutput = (content: string | Record<string, unknown>[] | null, formatted: boolean): string => {
    if (content === null) return 'null';
    if (typeof content === 'string') return content;

    // Handle MCP-style content array - just show the text
    if (Array.isArray(content)) {
      const mcpText = extractMcpText(content);
      if (mcpText !== null) {
        if (!formatted) {
          // In raw mode, try to parse and pretty-print if it's JSON
          try {
            const parsed = JSON.parse(mcpText);
            return JSON.stringify(parsed, null, 2);
          } catch {
            return mcpText;
          }
        }
        return mcpText;
      }

      // Fallback for non-MCP arrays
      if (content.length === 0) return '(empty)';
      if (formatted) {
        return content.map((item, i) => {
          const itemStr = formatValueReadable(item, 1);
          if (itemStr.includes('\n')) {
            return `Item ${i + 1}:\n${itemStr}`;
          }
          return `Item ${i + 1}: ${itemStr}`;
        }).join('\n\n');
      }
    }

    if (formatted) {
      return formatValueReadable(content, 0);
    }
    // Raw = pretty-printed JSON
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  };

  // Check if this tool has an MCP App registered (discovered via /api/mcp/tool-apps).
  // If so, the app IS the UI — render it bare, no tool-call chrome around it.
  // Falls through to the normal block while pending or on error so the user still
  // sees status/error feedback.
  const resourceUri = toolApps[toolUse.name];
  if (resourceUri && toolResult && !toolResult.is_error) {
    return (
      <McpAppFrame
        appPath={resourceUri}
        toolUseId={toolUse.id}
        toolInput={toolUse.input}
        toolResult={{
          content: toolResult.content,
          structuredContent: toolResult.structuredContent,
        }}
        answered={mcpAppAnswers?.get(toolUse.id)}
      />
    );
  }

  const truncatePreview = (text: string, maxLength: number = 80): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  // Format tool name for display - strip MCP prefix and make readable
  const formatToolName = (name: string): string => {
    // Strip mcp__<server>__ prefix, then snake_case → spaces
    const stripped = name.replace(/^mcp__[^_]+__/, '');
    return stripped.replace(/_/g, ' ');
  };

  // Strip the long session-sandbox prefix so the header shows e.g.
  // "client_data.xlsx" not "/root/src/.../sessions/2026.../sandbox/client_data.xlsx".
  // Paths outside a sandbox keep their last two segments for context.
  const shortenPath = (p: string): string => {
    const i = p.indexOf('/sandbox/');
    if (i !== -1) return p.slice(i + '/sandbox/'.length);
    const parts = p.split('/').filter(Boolean);
    return parts.length <= 2 ? p : '…/' + parts.slice(-2).join('/');
  };

  // Generate a brief preview of the tool input with actual values
  const getInputPreview = (): string => {
    const input = toolUse.input;
    const entries = Object.entries(input);
    if (entries.length === 0) return '';

    // For common patterns, show a more readable preview
    if (input.query) return `"${truncatePreview(String(input.query), 50)}"`;
    if (input.command) {
      // Prefer description over raw command (which contains file paths)
      if (input.description) return truncatePreview(String(input.description), 60);
      return `$ ${truncatePreview(String(input.command), 50)}`;
    }
    if (input.url) return truncatePreview(String(input.url), 50);

    // Filesystem tools — Read/Write/Edit use file_path, Grep/Glob/LS use path,
    // NotebookEdit uses notebook_path. Show the sandbox-relative name plus the
    // most relevant secondary param (Grep/Glob pattern).
    const pathVal = input.file_path ?? input.path ?? input.notebook_path;
    if (pathVal) {
      const short = truncatePreview(shortenPath(String(pathVal)), 50);
      if (input.pattern) return `${short} · ${truncatePreview(String(input.pattern), 30)}`;
      return short;
    }

    // Show key=value pairs for other inputs
    const formatValue = (v: unknown): string => {
      if (v === null || v === undefined) return 'null';
      if (typeof v === 'string') return v.length > 20 ? `"${v.slice(0, 20)}..."` : `"${v}"`;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      if (Array.isArray(v)) return `[${v.length} items]`;
      if (typeof v === 'object') return '{...}';
      return String(v);
    };

    const pairs = entries.slice(0, 4).map(([k, v]) => `${k}=${formatValue(v)}`);
    const suffix = entries.length > 4 ? ` +${entries.length - 4} more` : '';
    return pairs.join(', ') + suffix;
  };

  return (
    <div className={`tool-call-block ${getStatusClass()}`}>
      <button
        className="tool-call-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <span className="status-indicator">
          {getStatusIcon()}
        </span>
        <Wrench className="tool-icon" size={14} />
        <span className="tool-name">{formatToolName(toolUse.name)}</span>
        <span className="tool-preview">{getInputPreview()}</span>
        <span className="expand-icon">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {isExpanded && (
        <div className="tool-call-details">
          <div className="format-toggle-container">
            <button
              className={`format-toggle-btn ${isFormatted ? 'active' : ''}`}
              onClick={() => setIsFormatted(true)}
              title="Human-readable format"
            >
              <FileJson size={14} />
              <span>Readable</span>
            </button>
            <button
              className={`format-toggle-btn ${!isFormatted ? 'active' : ''}`}
              onClick={() => setIsFormatted(false)}
              title="Raw JSON"
            >
              <Code size={14} />
              <span>JSON</span>
            </button>
          </div>

          <div className="tool-section">
            <div className="tool-section-header">Input</div>
            <pre className={`tool-content ${!isFormatted ? 'raw' : ''}`}>{formatInput(toolUse.input, isFormatted)}</pre>
          </div>

          {toolResult && (
            <div className="tool-section">
              <div className="tool-section-header">
                Output {toolResult.is_error && <span className="error-badge">Error</span>}
              </div>
              <pre className={`tool-content ${toolResult.is_error ? 'error' : ''} ${!isFormatted ? 'raw' : ''}`}>
                {formatOutput(toolResult.content, isFormatted)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ToolCallBlock;
