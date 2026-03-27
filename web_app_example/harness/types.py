"""Shared type definitions for the agent harness."""

from typing import Callable

from claude_agent_sdk import ClaudeAgentOptions

# A function that returns agent configuration.
# Sandbox isolation is applied automatically by the harness.
AgentFactory = Callable[[], ClaudeAgentOptions]
