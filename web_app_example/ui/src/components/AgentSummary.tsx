import { useMemo, useState } from 'react';
import { FileText, Hash, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { parseAgent, type AgentAction, type AgentTopic } from '../highlight/parseAgent';
import './AgentSummary.css';

const ACTION_LABELS: Record<AgentAction['kind'], string> = {
  flow: 'Flow',
  apex: 'Apex',
  prompt: 'Prompt',
  transition: 'Transition',
  other: 'Action',
};

function prettyTarget(a: AgentAction): string {
  if (a.kind === 'transition') {
    return a.target.match(/@topic\.([\w{}]+)/)?.[1] ?? a.target;
  }
  return a.target.replace(/^(flow|apex|generatePromptResponse):\/\//, '');
}

function Field({ label, value, required }: {
  label: string;
  value?: string;
  required?: boolean;
}) {
  return (
    <div className="slds-field">
      <div className="slds-field-label">
        {required && <span className="slds-required">*</span>}
        {label}
      </div>
      <div className="slds-field-value">{value || '—'}</div>
    </div>
  );
}

function TopicRow({ topic }: { topic: AgentTopic }) {
  const [open, setOpen] = useState(false);
  const hasDetail = topic.instructions.length > 0 || topic.actions.length > 0;

  return (
    <>
      <tr className={hasDetail ? 'slds-row-expandable' : ''}
          onClick={() => hasDetail && setOpen(!open)}>
        <td className="slds-topic-cell">
          {hasDetail && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
          <span className="slds-topic-badge"><Hash size={12} /></span>
          {topic.name}
          {topic.isStart && <span className="slds-pill">Entry</span>}
        </td>
        <td>{topic.description || topic.label || ''}</td>
      </tr>
      {open && hasDetail && (
        <tr className="slds-detail-row">
          <td colSpan={2}>
            {topic.instructions.length > 0 && (
              <>
                <div className="slds-detail-label">Instructions</div>
                <ul className="slds-instructions">
                  {topic.instructions.map((ins, i) => <li key={i}>{ins}</li>)}
                </ul>
              </>
            )}
            {topic.actions.length > 0 && (
              <>
                <div className="slds-detail-label">Actions</div>
                <div className="slds-actions">
                  {topic.actions.map((a) => (
                    <span key={a.name} className={`slds-action slds-action-${a.kind}`}>
                      <strong>{ACTION_LABELS[a.kind]}</strong> · {prettyTarget(a)}
                    </span>
                  ))}
                </div>
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function AgentSummary({ source }: { source: string }) {
  const agent = useMemo(() => parseAgent(source), [source]);

  return (
    <div className="slds-agent">
      {/* ── Page header ────────────────────────────── */}
      <header className="slds-header">
        <span className="slds-header-icon"><FileText size={20} /></span>
        <h1>Agent Definition</h1>
      </header>

      {/* ── Basic Information ──────────────────────── */}
      <section className="slds-section">
        <h2>Basic Information</h2>
        <div className="slds-field-grid">
          <Field label="Agent Name" value={agent.label} />
          <Field label="Developer Name" value={agent.developerName} required />
        </div>
        <div className="slds-field-full">
          <div className="slds-field-label">
            <span className="slds-required">*</span>
            Description
            <Info size={13} className="slds-info-icon" />
          </div>
          <div className="slds-field-value">{agent.description || '—'}</div>
        </div>
        {agent.agentType && (
          <div className="slds-field-grid">
            <Field label="Agent Type" value={agent.agentType} />
            <Field label="Entry Topic" value={agent.startTopic} />
          </div>
        )}
      </section>

      {/* ── System Messages ────────────────────────── */}
      {(agent.systemInstructions || agent.welcomeMessage) && (
        <section className="slds-section">
          <h2>System Messages</h2>
          {agent.systemInstructions && (
            <div className="slds-field-full">
              <div className="slds-field-label">Instructions</div>
              <div className="slds-field-value">{agent.systemInstructions}</div>
            </div>
          )}
          <div className="slds-field-grid">
            <Field label="Welcome Message" value={agent.welcomeMessage} />
            <Field label="Error Message" value={agent.errorMessage} />
          </div>
        </section>
      )}

      {/* ── Topics ─────────────────────────────────── */}
      {agent.topics.length > 0 && (
        <section className="slds-section">
          <h2>Topics</h2>
          <p className="slds-section-help">
            Topics represent the jobs your agent can perform. Each includes
            actions, instructions, and metadata that guide how the agent responds.
          </p>
          <table className="slds-table">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {agent.topics.map((t) => <TopicRow key={t.name} topic={t} />)}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Variables ──────────────────────────────── */}
      {agent.variables.length > 0 && (
        <section className="slds-section">
          <h2>Variables</h2>
          <table className="slds-table">
            <thead>
              <tr><th>Name</th><th>Type</th><th>Description</th></tr>
            </thead>
            <tbody>
              {agent.variables.map((v) => (
                <tr key={v.name}>
                  <td><code>{v.name}</code></td>
                  <td>
                    {v.modifier && <span className="slds-pill">{v.modifier}</span>} {v.type}
                  </td>
                  <td>{v.description || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
