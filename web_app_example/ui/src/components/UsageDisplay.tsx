import { Coins, Bot, Cpu } from 'lucide-react';
import type { UsageMetrics, AgentContextMetrics } from '../types';
import './UsageDisplay.css';

interface UsageDisplayProps {
  usage: UsageMetrics | null;
}

/**
 * Formats a number with K/M suffix for compact display
 */
function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

/**
 * Formats USD cost with appropriate precision
 */
function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  if (cost < 1) {
    return `$${cost.toFixed(3)}`;
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Renders context info for a single agent
 */
function AgentContext({
  label,
  icon: Icon,
  metrics
}: {
  label: string;
  icon: React.ComponentType<{ size: number }>;
  metrics: AgentContextMetrics;
}) {
  const totalTokens = metrics.input_tokens + metrics.output_tokens;
  if (totalTokens === 0) return null;

  return (
    <div className="usage-item" title={`${label}: ${formatTokenCount(metrics.input_tokens)} in / ${formatTokenCount(metrics.output_tokens)} out`}>
      <Icon size={12} />
      <span className="usage-value">
        {label}: {metrics.context_utilization_pct.toFixed(1)}%
      </span>
    </div>
  );
}

export function UsageDisplay({ usage }: UsageDisplayProps) {
  if (!usage) {
    return null;
  }

  return (
    <div className="usage-display">
      <div className="usage-item" title="Total cost (all agents)">
        <Coins size={12} />
        <span className="usage-value">{formatCost(usage.total_cost_usd)}</span>
      </div>

      <AgentContext label="Main" icon={Cpu} metrics={usage.main_agent} />
      <AgentContext label="Sub" icon={Bot} metrics={usage.subagent} />
    </div>
  );
}

export default UsageDisplay;
