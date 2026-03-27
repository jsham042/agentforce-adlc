/**
 * Lightweight Agent Script parser for the non-technical summary view.
 *
 * This is NOT a full compiler — it only extracts the fields the summary
 * UI needs (config, system messages, topics, variables, actions).  It is
 * forgiving about whitespace and ignores anything it doesn't recognise.
 */

export interface AgentVariable {
  name: string;
  modifier: 'linked' | 'mutable' | '';
  type: string;
  description?: string;
}

export interface AgentAction {
  name: string;
  target: string;           // raw right-hand side
  kind: 'flow' | 'apex' | 'prompt' | 'transition' | 'other';
}

export interface AgentTopic {
  name: string;
  label?: string;
  description?: string;
  instructions: string[];   // the | literal lines, stripped
  actions: AgentAction[];
  isStart: boolean;
}

export interface ParsedAgent {
  label?: string;
  description?: string;
  developerName?: string;
  agentType?: string;
  systemInstructions?: string;
  welcomeMessage?: string;
  errorMessage?: string;
  startTopic?: string;
  topics: AgentTopic[];
  variables: AgentVariable[];
}

const unquote = (s: string) => s.replace(/^"(.*)"$/, '$1');

const actionKind = (rhs: string): AgentAction['kind'] => {
  if (/^flow:\/\//.test(rhs)) return 'flow';
  if (/^apex:\/\//.test(rhs)) return 'apex';
  if (/^generatePromptResponse:\/\//.test(rhs)) return 'prompt';
  if (/@utils\.transition/.test(rhs)) return 'transition';
  return 'other';
};

export function parseAgent(src: string): ParsedAgent {
  const lines = src.split(/\r?\n/);
  const out: ParsedAgent = { topics: [], variables: [] };

  // Current block context (set by column-0 headers)
  type Block = 'system' | 'config' | 'variables' | 'language' | 'topic' | '';
  let block: Block = '';
  let topic: AgentTopic | null = null;
  let inActions = false;
  let currentVar: AgentVariable | null = null;

  for (const raw of lines) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;

    const indent = raw.match(/^\t*/)![0].length;
    const line = raw.trim();

    // ── Column-0 headers ────────────────────────────────────────────
    if (indent === 0) {
      inActions = false;
      currentVar = null;

      const topicMatch = line.match(/^topic\s+([A-Za-z_{][\w{}]*)\s*:/);
      if (topicMatch) {
        block = 'topic';
        topic = { name: topicMatch[1], instructions: [], actions: [], isStart: false };
        out.topics.push(topic);
        continue;
      }

      const startMatch = line.match(/^start_agent\s*:\s*(\S+)/);
      if (startMatch) { out.startTopic = startMatch[1]; continue; }

      const headerMatch = line.match(/^(\w+)\s*:/);
      if (headerMatch) {
        const h = headerMatch[1];
        block = (['system', 'config', 'variables', 'language'].includes(h) ? h : '') as Block;
        topic = null;
        continue;
      }
      continue;
    }

    // ── Nested content ──────────────────────────────────────────────
    const kv = line.match(/^([A-Za-z_]\w*)\s*:\s*(.*)$/);

    if (block === 'config' && kv) {
      const [, k, v] = kv;
      const val = unquote(v);
      if (k === 'agent_label') out.label = val;
      else if (k === 'description') out.description = val;
      else if (k === 'developer_name') out.developerName = val;
      else if (k === 'agent_type') out.agentType = val;
      continue;
    }

    if (block === 'system' && kv) {
      const [, k, v] = kv;
      const val = unquote(v);
      if (k === 'instructions') out.systemInstructions = val;
      else if (k === 'welcome') out.welcomeMessage = val;
      else if (k === 'error') out.errorMessage = val;
      continue;
    }

    if (block === 'variables') {
      // Variable declaration at indent 1:  Name: linked string = "…"
      if (indent === 1 && kv) {
        const [, name, rhs] = kv;
        const m = rhs.match(/^(linked|mutable)?\s*(\w+)/);
        currentVar = {
          name,
          modifier: (m?.[1] as AgentVariable['modifier']) || '',
          type: m?.[2] || rhs,
        };
        out.variables.push(currentVar);
        continue;
      }
      // description under a variable
      if (indent >= 2 && currentVar && kv?.[1] === 'description') {
        currentVar.description = unquote(kv[2]);
        continue;
      }
      continue;
    }

    if (block === 'topic' && topic) {
      // `| literal instruction line`
      if (line.startsWith('|')) {
        topic.instructions.push(line.slice(1).trim());
        continue;
      }
      if (kv) {
        const [, k, v] = kv;
        if (k === 'label') { topic.label = unquote(v); continue; }
        if (k === 'description') { topic.description = unquote(v); continue; }
        if (k === 'actions') { inActions = true; continue; }
        if (k === 'reasoning' || k === 'instructions') { inActions = false; continue; }
        if (inActions) {
          topic.actions.push({ name: k, target: v, kind: actionKind(v) });
          continue;
        }
      }
    }
  }

  // Mark the start topic
  if (out.startTopic) {
    const t = out.topics.find((x) => x.name === out.startTopic);
    if (t) t.isStart = true;
  }

  return out;
}
