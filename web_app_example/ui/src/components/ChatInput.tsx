import { useState, useRef, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import { Send, Paperclip, X, Loader2 } from 'lucide-react';
import './ChatInput.css';

/**
 * A chip shown above the input. If `file` is present, the bytes are staged
 * locally and will ride along with the next Send. If `file` is absent, the
 * upload already happened (mid-session immediate path) and the chip is just
 * a confirmation.
 */
interface Chip {
  name: string;
  file?: File;
}

interface ChatInputProps {
  /** Staged files are passed alongside the text on first send. */
  onSend: (message: string, stagedFiles: File[]) => void;
  /** Mid-session immediate upload. Only called when sessionActive is true. */
  onAttach?: (files: FileList) => Promise<string[]>;
  /** Drives the stage-vs-upload-now decision. */
  sessionActive: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  onAttach,
  sessionActive,
  disabled = false,
  placeholder = 'Enter your message...',
}: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [chips, setChips] = useState<Chip[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [message]);

  const handleSubmit = () => {
    const trimmed = message.trim();
    if (trimmed && !disabled) {
      const staged = chips.map((c) => c.file).filter((f): f is File => !!f);
      onSend(trimmed, staged);
      setMessage('');
      setChips([]);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    if (sessionActive && onAttach) {
      // Mid-session: upload now. Chip is a confirmation, not a staged file.
      setUploading(true);
      try {
        const landed = await onAttach(files);
        setChips((prev) => [...prev, ...landed.map((name) => ({ name }))]);
      } finally {
        setUploading(false);
      }
    } else {
      // Pre-session: stage locally. Session is created on Send, not here —
      // no orphan sessions from a paperclip-then-bail.
      setChips((prev) => [
        ...prev,
        ...Array.from(files).map((f) => ({ name: f.name, file: f })),
      ]);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="chat-input-container">
      {chips.length > 0 && (
        <div className="chat-attachment-chips">
          {chips.map((chip, i) => (
            <div
              key={`${chip.name}-${i}`}
              className={`chat-attachment-chip ${chip.file ? 'staged' : ''}`}
            >
              <Paperclip size={12} />
              <span className="chip-name">{chip.name}</span>
              <button
                className="chip-dismiss"
                onClick={() => setChips((p) => p.filter((_, idx) => idx !== i))}
                aria-label={`Remove ${chip.name}`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="chat-input-wrapper">
        {onAttach && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="chat-file-input"
              onChange={handleFileSelect}
            />
            <button
              className="chat-attach-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label="Attach files"
              title="Attach files to the shared drive"
            >
              {uploading
                ? <Loader2 className="icon spinning" size={18} />
                : <Paperclip size={18} />}
            </button>
          </>
        )}
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
        />
        <button
          className="chat-send-button"
          onClick={handleSubmit}
          disabled={disabled || !message.trim()}
          aria-label="Send message"
        >
          <Send className="icon" size={20} />
        </button>
      </div>
      <div className="chat-input-hint">
        Press Enter to send, Shift+Enter for new line
      </div>
    </div>
  );
}

export default ChatInput;
