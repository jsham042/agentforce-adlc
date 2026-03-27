import { useRef, useEffect, useState, useCallback } from 'react';
import './McpAppFrame.css';

interface McpAppFrameProps {
  /** MCP resource URI for the app HTML (e.g., "ui://weather/get_weather.html") */
  appPath: string;
  /** The tool_use block id — included in submit-response events for attribution */
  toolUseId: string;
  /** Tool input arguments */
  toolInput?: Record<string, unknown>;
  /** Tool result with optional structuredContent */
  toolResult?: {
    content?: unknown;
    structuredContent?: Record<string, unknown>;
  };
  /** If the user already answered this app (e.g., after session rehydration),
   *  the answer text. App should render its submitted state, not re-prompt. */
  answered?: string;
}

/**
 * Renders an MCP App in a sandboxed iframe and communicates via the
 * MCP Apps postMessage protocol (JSON-RPC 2.0).
 */
export function McpAppFrame({ appPath, toolUseId, toolInput, toolResult, answered }: McpAppFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(120);
  const pendingRef = useRef<Map<number, (result: unknown) => void>>(new Map());

  // Handle messages from the iframe
  const handleMessage = useCallback((event: MessageEvent) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || !msg.jsonrpc) return;

    // Only handle messages from our iframe
    if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;

    // Handle JSON-RPC requests from the app
    if (msg.method) {
      switch (msg.method) {
        case 'ui/initialize': {
          // Respond with host context
          const response = {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              hostContext: {
                theme: document.body.classList.contains('theme-light') ? 'light' : 'dark',
                appearance: document.body.classList.contains('theme-light') ? 'light' : 'dark',
              },
            },
          };
          iframeRef.current?.contentWindow?.postMessage(response, '*');
          break;
        }
        case 'ui/notifications/initialized': {
          setIsLoaded(true);
          // Send tool input and result now that the app is ready
          sendToolData();
          break;
        }
        case 'ui/submit-response': {
          // MCP App submitted user input (e.g., clarification form)
          // Dispatch a DOM event so App.tsx can inject it as a chat message
          const text = msg.params?.text;
          if (text) {
            document.dispatchEvent(new CustomEvent('mcp-app-user-response', {
              detail: { text, toolUseId },
            }));
          }
          break;
        }
        case 'tools/call': {
          // App wants to re-query a tool — not supported in this harness
          // Respond with an error
          const errorResponse = {
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32601, message: 'Tool re-query not supported in this viewer' },
          };
          iframeRef.current?.contentWindow?.postMessage(errorResponse, '*');
          break;
        }
      }
    }

    // Handle JSON-RPC responses (to our requests)
    if (msg.id && pendingRef.current.has(msg.id)) {
      pendingRef.current.get(msg.id)!(msg.result || msg.error);
      pendingRef.current.delete(msg.id);
    }
  }, [toolUseId]);

  // Send tool input and result data to the iframe
  const sendToolData = useCallback(() => {
    const iframe = iframeRef.current?.contentWindow;
    if (!iframe) return;

    // Send tool input
    if (toolInput) {
      iframe.postMessage({
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-input',
        params: { arguments: toolInput },
      }, '*');
    }

    // Send tool result
    if (toolResult) {
      iframe.postMessage({
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-result',
        params: { result: toolResult },
      }, '*');
    }

    // If this app was already answered (session rehydration), tell it so
    if (answered) {
      iframe.postMessage({
        jsonrpc: '2.0',
        method: 'ui/notifications/answered',
        params: { text: answered },
      }, '*');
    }
  }, [toolInput, toolResult, answered]);

  // Re-send data when tool result changes (and iframe is already loaded)
  useEffect(() => {
    if (isLoaded) {
      sendToolData();
    }
  }, [isLoaded, sendToolData]);

  // Listen for messages from iframe
  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // Auto-resize iframe based on content
  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => {
      try {
        const body = iframeRef.current?.contentDocument?.body;
        if (body) {
          const newHeight = Math.min(Math.max(body.scrollHeight + 4, 40), 600);
          setIframeHeight(newHeight);
        }
      } catch {
        // Cross-origin — can't measure, use default
      }
    });

    const iframe = iframeRef.current;
    if (iframe) {
      iframe.addEventListener('load', () => {
        try {
          if (iframe.contentDocument?.body) {
            resizeObserver.observe(iframe.contentDocument.body);
          }
        } catch {
          // Cross-origin fallback
        }
      });
    }

    return () => resizeObserver.disconnect();
  }, []);

  // appPath is an MCP resource URI (e.g., 'ui://weather/get_weather.html')
  const srcUrl = `/api/mcp/resources/${encodeURIComponent(appPath)}`;

  return (
    <div className="mcp-app-frame-container">
      <iframe
        ref={iframeRef}
        src={srcUrl}
        className="mcp-app-iframe"
        style={{ height: `${iframeHeight}px` }}
        sandbox="allow-scripts allow-same-origin"
        title="MCP App"
      />
      {!isLoaded && (
        <div className="mcp-app-loading">Loading app...</div>
      )}
    </div>
  );
}

export default McpAppFrame;
