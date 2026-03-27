import { User, Network, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ContentBlock, ToolResultBlock, ToolUseBlock } from '../types';
import { ToolCallBlock } from './ToolCallBlock';
import { ToolCallGroup } from './ToolCallGroup';
import { ThinkingBlock } from './ThinkingBlock';
import './MessageBubble.css';

interface MessageBubbleProps {
  message: Message;
  toolResults?: Map<string, ToolResultBlock>;
  executingTools?: Set<string>;
  isSubagent?: boolean;
  toolApps?: Record<string, string>;
  mcpAppAnswers?: Map<string, string>;
}

export function MessageBubble({
  message,
  toolResults = new Map(),
  executingTools = new Set(),
  isSubagent = false,
  toolApps = {},
  mcpAppAnswers,
}: MessageBubbleProps) {
  const renderContentBlock = (block: ContentBlock, index: number) => {
    switch (block.type) {
      case 'text':
        return (
          <div key={index} className="text-content markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {block.text}
            </ReactMarkdown>
          </div>
        );

      case 'thinking':
        return <ThinkingBlock key={index} thinking={block} />;

      case 'tool_use':
        return (
          <ToolCallBlock
            key={index}
            toolUse={block}
            toolResult={toolResults.get(block.id)}
            isExecuting={executingTools.has(block.id)}
            toolApps={toolApps}
            mcpAppAnswers={mcpAppAnswers}
          />
        );

      case 'tool_result':
        // Tool results are typically shown inline with tool_use blocks
        // but we can render standalone ones too
        return (
          <div key={index} className={`tool-result-standalone ${block.is_error ? 'error' : ''}`}>
            <span className="tool-result-label">Tool Result:</span>
            <pre className="tool-result-content">
              {typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content, null, 2)}
            </pre>
          </div>
        );

      default:
        return null;
    }
  };

  const renderUserMessage = () => {
    if (message.type !== 'user') return null;

    const content = typeof message.content === 'string'
      ? message.content
      : message.content.map((block, i) => renderContentBlock(block, i));

    return (
      <div className={`message-bubble user ${isSubagent ? 'subagent' : ''}`}>
        <div className="message-avatar">
          <User size={18} />
        </div>
        <div className="message-content">
          {typeof content === 'string' ? (
            <div className="text-content markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          ) : (
            content
          )}
        </div>
      </div>
    );
  };

  // Group consecutive tool_use blocks together.
  // Task tool_use blocks are dropped here — the SubagentPanel owns that
  // UX (it shows the dispatch prompt + subagent output in one box).
  const groupContentBlocks = (blocks: ContentBlock[]): (ContentBlock | ToolUseBlock[])[] => {
    const result: (ContentBlock | ToolUseBlock[])[] = [];
    let currentToolGroup: ToolUseBlock[] = [];

    for (const block of blocks) {
      if (block.type === 'tool_use') {
        if ((block as ToolUseBlock).name === 'Task') continue;
        currentToolGroup.push(block);
      } else {
        if (currentToolGroup.length > 0) {
          result.push(currentToolGroup);
          currentToolGroup = [];
        }
        result.push(block);
      }
    }

    if (currentToolGroup.length > 0) {
      result.push(currentToolGroup);
    }

    return result;
  };

  const renderGroupedContent = (item: ContentBlock | ToolUseBlock[], index: number) => {
    // If it's an array, it's a group of tool_use blocks
    if (Array.isArray(item)) {
      return (
        <ToolCallGroup
          key={`tool-group-${index}`}
          toolUses={item}
          toolResults={toolResults}
          executingTools={executingTools}
          toolApps={toolApps}
          mcpAppAnswers={mcpAppAnswers}
        />
      );
    }
    // Otherwise render the individual block
    return renderContentBlock(item, index);
  };

  const renderAssistantMessage = () => {
    if (message.type !== 'assistant') return null;

    // Skip messages that are purely Task dispatches — the SubagentPanel
    // absorbs those. Thinking is no longer filtered; it renders inline.
    const hasVisibleContent = message.content.some(
      b => !(b.type === 'tool_use' && (b as ToolUseBlock).name === 'Task')
    );
    if (!hasVisibleContent) return null;

    const groupedContent = groupContentBlocks(message.content);

    return (
      <div className={`message-bubble assistant ${isSubagent ? 'subagent' : ''}`}>
        <div className="message-avatar" aria-hidden="true">
          {isSubagent && <Network size={16} />}
        </div>
        <div className="message-content">
          {message.error && (
            <div className="message-error">
              <AlertCircle size={14} />
              <span>{message.error.message}</span>
            </div>
          )}
          {groupedContent.map((item, index) => renderGroupedContent(item, index))}
        </div>
      </div>
    );
  };

  const renderSystemMessage = () => {
    if (message.type !== 'system') return null;

    return (
      <div className="message-bubble system">
        <div className="system-content markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    );
  };

  return (
    <>
      {message.type === 'user' && renderUserMessage()}
      {message.type === 'assistant' && renderAssistantMessage()}
      {message.type === 'system' && renderSystemMessage()}
    </>
  );
}

export default MessageBubble;
