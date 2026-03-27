import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FileText, Code, ChevronDown, ChevronRight, X, FolderOpen, Download, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';
import java from 'highlight.js/lib/languages/java';
import agentscript from '../highlight/agentscript';
import { AgentSummary } from './AgentSummary';
import 'highlight.js/styles/github.css';
import './Artifacts.css';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('java', java);
hljs.registerLanguage('agentscript', agentscript);

interface Artifact {
  name: string;
  path: string;
  size: number;
}

interface ArtifactsProps {
  sessionId: string | undefined;
}

export function Artifacts({ sessionId }: ArtifactsProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const [openFile, setOpenFile] = useState<{ name: string; path: string; content?: string; kind: 'text' | 'code' | 'image' | 'binary' | 'csv' | 'html' } | null>(null);
  const [agentView, setAgentView] = useState<'summary' | 'code'>('summary');
  const codeRef = useRef<HTMLElement>(null);
  const [loading, setLoading] = useState(false);

  const fetchArtifacts = useCallback(async () => {
    if (!sessionId) {
      setArtifacts([]);
      return;
    }
    try {
      const res = await fetch(`/api/sessions/${sessionId}/artifacts`);
      if (!res.ok) {
        setArtifacts([]);
        return;
      }
      const data = await res.json();
      setArtifacts(data.artifacts || []);
    } catch {
      setArtifacts([]);
    }
  }, [sessionId]);

  // Poll for artifacts while session is active
  useEffect(() => {
    fetchArtifacts();
    const interval = setInterval(fetchArtifacts, 5000);
    return () => clearInterval(interval);
  }, [fetchArtifacts]);

  const CODE_EXTS = /\.(py|js|ts|jsx|tsx|sh|bash|rb|go|rs|java|c|cpp|h|hpp|cs|r|sql|mjs|cjs|agent|xml|cls|trigger)$/i;
  const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
  const BINARY_EXTS = /\.(pptx?|docx?|xlsx?|pdf|zip)$/i;
  const HTML_EXTS = /\.html?$/i;

  const { deliverables, code } = useMemo(() => {
    const d: Artifact[] = [];
    const c: Artifact[] = [];
    for (const a of artifacts) {
      (CODE_EXTS.test(a.name) ? c : d).push(a);
    }
    return { deliverables: d, code: c };
  }, [artifacts]);

  const openArtifact = async (artifact: Artifact) => {
    if (!sessionId) return;

    // Images & HTML: render directly via raw-file endpoint — no fetch needed
    if (IMAGE_EXTS.test(artifact.name)) {
      setOpenFile({ name: artifact.name, path: artifact.path, kind: 'image' });
      return;
    }
    if (HTML_EXTS.test(artifact.name)) {
      setOpenFile({ name: artifact.name, path: artifact.path, kind: 'html' });
      return;
    }

    // Known binary files (pptx, docx, etc): offer download, don't fetch as text
    if (BINARY_EXTS.test(artifact.name)) {
      setOpenFile({ name: artifact.name, path: artifact.path, kind: 'binary' });
      return;
    }

    // Text, code, or csv: fetch content as JSON
    const kind = /\.csv$/i.test(artifact.name) ? 'csv'
               : CODE_EXTS.test(artifact.name) ? 'code'
               : 'text';
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/artifacts/${artifact.path}`);
      const data = await res.json();
      setOpenFile({ name: data.name, path: artifact.path, content: data.content, kind });
    } catch {
      setOpenFile({ name: artifact.name, path: artifact.path, content: 'Failed to load file.', kind });
    } finally {
      setLoading(false);
    }
  };

  const isAgentFile = openFile?.name.endsWith('.agent') ?? false;

  // Apply syntax highlighting when code content is displayed
  useEffect(() => {
    if (openFile?.kind === 'code' && codeRef.current &&
        !(isAgentFile && agentView === 'summary')) {
      hljs.highlightElement(codeRef.current);
    }
  }, [openFile, agentView, isAgentFile]);

  const langFromName = (name: string): string => {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
      ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
      sh: 'bash', bash: 'bash', sql: 'sql',
      agent: 'agentscript', xml: 'xml',
      cls: 'java', trigger: 'java',  // Apex ≈ Java for highlighting
    };
    return map[ext] || '';
  };

  const extOf = (name: string) => {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i + 1).toLowerCase() : '';
  };

  // Minimal CSV parser — handles quoted fields, commas-in-quotes, and "" escapes.
  // Good enough for pandas .to_csv() output, which is what the agent writes.
  const parseCsv = (text: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c === '\r') { /* skip */ }
        else field += c;
      }
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  };

  return (
    <>
      <div className="artifacts-container">
        <div className="artifacts-header-row">
          <button
            className="artifacts-header"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <span className="expand-icon">
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <FolderOpen className="header-icon" size={18} />
            <h2 className="header-title">Artifacts</h2>
            {artifacts.length > 0 && (
              <span className="artifacts-count">{artifacts.length}</span>
            )}
          </button>
        </div>

        {isExpanded && (
          <div className="artifacts-list">
            {artifacts.length === 0 ? (
              <div className="artifacts-empty">
                <FileText size={20} />
                <p>No artifacts yet</p>
                <span className="empty-hint">Files the agent writes will appear here</span>
              </div>
            ) : (
              <>
                {deliverables.map((artifact) => (
                  <button
                    key={artifact.path}
                    className="artifact-item"
                    onClick={() => openArtifact(artifact)}
                  >
                    <FileText size={14} className="artifact-icon" />
                    <span className="artifact-name">{artifact.name}</span>
                    <span className="artifact-ext">{extOf(artifact.name)}</span>
                  </button>
                ))}
                {code.length > 0 && (
                  <>
                    <div className="artifacts-section-label">
                      <Code size={12} />
                      <span>Build scripts</span>
                    </div>
                    {code.map((artifact) => (
                      <button
                        key={artifact.path}
                        className="artifact-item artifact-item-code"
                        onClick={() => openArtifact(artifact)}
                      >
                        <Code size={14} className="artifact-icon" />
                        <span className="artifact-name">{artifact.name}</span>
                        <span className="artifact-ext">{extOf(artifact.name)}</span>
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {openFile && (
        <div className="artifact-modal-overlay" onClick={() => setOpenFile(null)}>
          <div className="artifact-modal" onClick={(e) => e.stopPropagation()}>
            <div className="artifact-modal-header">
              {openFile.kind === 'code' ? <Code size={16} /> : <FileText size={16} />}
              <span className="artifact-modal-title">{openFile.name}</span>
              {isAgentFile && (
                <div className="artifact-view-toggle">
                  <button
                    className={agentView === 'summary' ? 'active' : ''}
                    onClick={() => setAgentView('summary')}
                  >Summary</button>
                  <button
                    className={agentView === 'code' ? 'active' : ''}
                    onClick={() => setAgentView('code')}
                  >Code</button>
                </div>
              )}
              {openFile.kind === 'html' && (
                <a
                  className="artifact-modal-open-tab"
                  href={`/api/sessions/${sessionId}/artifacts-raw/${openFile.path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in new tab"
                >
                  <ExternalLink size={14} />
                </a>
              )}
              <button className="artifact-modal-close" onClick={() => setOpenFile(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="artifact-modal-content">
              {loading ? (
                <div className="artifact-loading">Loading...</div>
              ) : openFile.kind === 'image' ? (
                <img
                  src={`/api/sessions/${sessionId}/artifacts-raw/${openFile.path}`}
                  alt={openFile.name}
                  className="artifact-image"
                />
              ) : openFile.kind === 'html' ? (
                <iframe
                  src={`/api/sessions/${sessionId}/artifacts-raw/${openFile.path}`}
                  sandbox=""
                  className="artifact-html"
                  title={openFile.name}
                />
              ) : openFile.kind === 'binary' ? (
                <div className="artifact-loading">
                  <a
                    href={`/api/sessions/${sessionId}/artifacts-raw/${openFile.path}`}
                    download={openFile.name}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                  >
                    <Download size={16} /> Download {openFile.name}
                  </a>
                </div>
              ) : openFile.kind === 'csv' ? (
                <CsvTable rows={parseCsv(openFile.content || '')} />
              ) : openFile.kind === 'code' ? (
                isAgentFile && agentView === 'summary' ? (
                  <AgentSummary source={openFile.content || ''} />
                ) : (
                  <pre className="artifact-code"><code
                    ref={codeRef}
                    className={langFromName(openFile.name)}
                  >{openFile.content || ''}</code></pre>
                )
              ) : (
                <div className="artifact-text markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {openFile.content || ''}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CsvTable({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return <div className="artifact-loading">Empty file</div>;
  const [header, ...body] = rows;
  const display = body.slice(0, 500);
  return (
    <div className="artifact-csv-wrap">
      <table className="artifact-csv">
        <thead>
          <tr>{header.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {display.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {body.length > 500 && (
        <div className="artifact-csv-truncated">
          … {body.length - 500} more rows
        </div>
      )}
    </div>
  );
}

export default Artifacts;
