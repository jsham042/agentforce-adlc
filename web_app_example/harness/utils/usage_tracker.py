"""Tracks cumulative usage stats from SDK ResultMessage objects."""

from typing import Any

from claude_agent_sdk import ResultMessage


class UsageTracker:
    """Tracks usage stats from ResultMessage objects."""

    def __init__(self):
        self.total_cost_usd: float = 0.0
        self.turn_count: int = 0
        self.input_tokens: int = 0
        self.output_tokens: int = 0
        self.subagent_input_tokens: int = 0
        self.subagent_output_tokens: int = 0

    def update(self, result_msg: Any) -> None:
        """Update usage from a ResultMessage."""
        if not isinstance(result_msg, ResultMessage):
            return

        cost = getattr(result_msg, 'total_cost_usd', None)
        if cost:
            self.total_cost_usd += cost

        turns = getattr(result_msg, 'num_turns', None)
        if turns:
            self.turn_count += turns

        usage = getattr(result_msg, 'usage', None)
        if usage:
            inp = usage.get('input_tokens', 0) if isinstance(usage, dict) else getattr(usage, 'input_tokens', 0)
            out = usage.get('output_tokens', 0) if isinstance(usage, dict) else getattr(usage, 'output_tokens', 0)

            is_subagent = getattr(result_msg, 'parent_tool_use_id', None) is not None
            if is_subagent:
                self.subagent_input_tokens += inp
                self.subagent_output_tokens += out
            else:
                self.input_tokens += inp
                self.output_tokens += out

    def to_dict(self) -> dict:
        """Return usage in frontend-compatible format."""
        main_total = self.input_tokens + self.output_tokens
        sub_total = self.subagent_input_tokens + self.subagent_output_tokens
        return {
            "total_cost_usd": self.total_cost_usd,
            "turn_count": self.turn_count,
            "main_agent": {
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens,
                "context_utilization_pct": round((main_total / 200000) * 100, 1),
            },
            "subagent": {
                "input_tokens": self.subagent_input_tokens,
                "output_tokens": self.subagent_output_tokens,
                "context_utilization_pct": round((sub_total / 200000) * 100, 1),
            },
        }
