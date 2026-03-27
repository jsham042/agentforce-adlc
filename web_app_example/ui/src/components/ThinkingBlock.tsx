import { useState } from 'react';
import { ChevronDown, ChevronRight, Brain, Loader2 } from 'lucide-react';
import type { ThinkingBlock as ThinkingBlockType } from '../types';
import './ThinkingBlock.css';

interface ThinkingBlockProps {
  thinking: ThinkingBlockType;
  isActive?: boolean;
}

export function ThinkingBlock({ thinking, isActive = false }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const truncatePreview = (text: string, maxLength: number = 100): string => {
    const firstLine = text.split('\n')[0];
    if (firstLine.length <= maxLength) return firstLine;
    return firstLine.substring(0, maxLength) + '...';
  };

  return (
    <div className={`thinking-block ${isActive ? 'active' : ''}`}>
      <button
        className="thinking-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <span className="expand-icon">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        {isActive ? (
          <Loader2 className="thinking-icon spinning" size={14} />
        ) : (
          <Brain className="thinking-icon" size={14} />
        )}
        <span className="thinking-label">
          {isActive ? 'Thinking...' : 'Thinking'}
        </span>
        {!isExpanded && !isActive && (
          <span className="thinking-preview">
            {truncatePreview(thinking.thinking)}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="thinking-content-wrapper">
          <pre className="thinking-content">{thinking.thinking}</pre>
        </div>
      )}
    </div>
  );
}

// Placeholder for when thinking is in progress
export function ThinkingIndicator() {
  return (
    <div className="thinking-block active">
      <div className="thinking-header non-interactive">
        <Loader2 className="thinking-icon spinning" size={14} />
        <span className="thinking-label">Thinking...</span>
        <div className="thinking-dots">
          <span className="dot"></span>
          <span className="dot"></span>
          <span className="dot"></span>
        </div>
      </div>
    </div>
  );
}

export default ThinkingBlock;
