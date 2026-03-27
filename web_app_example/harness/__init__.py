"""Agent Harness - Reusable infrastructure for Claude Agent SDK applications.

This package provides reusable server and CLI infrastructure for building
agent applications with the Claude Agent SDK.

Usage:
    from harness import create_app, run_cli

    # Define your agent as a factory function
    def create_my_agent() -> ClaudeAgentOptions:
        return ClaudeAgentOptions(...)

    # Create a FastAPI app — sandbox isolation is applied automatically
    app = create_app(create_my_agent, {"agent_name": "My Agent"})

    # Or run as CLI
    run_cli(create_my_agent, agent_name="My Agent")
"""

from .types import AgentFactory
from .server import create_app, run_server
from .cli import run_cli, create_cli_runner
from .sandbox import apply_sandbox
from .session import SessionStore
from .mcp_apps import discover_tool_apps, register_mcp_app_resource
from .transcript import get_transcript_path, link_transcript
from .builtin_tools import apply_builtin_tools, ASK_USER_TOOL, DEFAULT_BUILTINS
from .utils.console_logger import print_activity

__all__ = [
    "AgentFactory",
    "apply_sandbox",
    "apply_builtin_tools",
    "ASK_USER_TOOL",
    "DEFAULT_BUILTINS",
    "create_app",
    "run_server",
    "run_cli",
    "create_cli_runner",
    "SessionStore",
    "discover_tool_apps",
    "register_mcp_app_resource",
    "get_transcript_path",
    "link_transcript",
    "print_activity",
]
