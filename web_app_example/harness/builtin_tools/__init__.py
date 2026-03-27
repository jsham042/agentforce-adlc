"""Built-in harness tools — generic utilities applicable to any web-UI agent.

Currently provides:
  - ask_user: present a multiple-choice question to the user via an
    interactive MCP App form. Replaces the SDK's AskUserQuestion tool,
    which assumes a CLI prompt and doesn't render in the WebSocket + web
    UI setup.

Enabled by default in ``create_app``. Disable with
``config={"builtin_tools": []}``.
"""

from dataclasses import replace
from pathlib import Path

from claude_agent_sdk import ClaudeAgentOptions, create_sdk_mcp_server

from ..mcp_apps import register_mcp_app_resource
from .ask_user import ask_user

_HERE = Path(__file__).parent
_SERVER_NAME = "harness"

_server = create_sdk_mcp_server(
    name=_SERVER_NAME, version="1.0.0",
    tools=[ask_user],
)

register_mcp_app_resource(
    _server,
    tool_name="ask_user",
    html=(_HERE / "ask_user.html").read_text(),
)

ASK_USER_TOOL = f"mcp__{_SERVER_NAME}__ask_user"
DEFAULT_BUILTINS = ["ask_user"]


def apply_builtin_tools(
    options: ClaudeAgentOptions,
    enabled: list[str],
) -> ClaudeAgentOptions:
    """Merge enabled builtin tools into agent options.

    Adds the harness MCP server to ``mcp_servers``, appends tool names to
    ``allowed_tools`` (only if it's already a non-empty whitelist — the
    SDK default of ``[]`` means "no whitelist", and appending would turn
    that into a one-tool whitelist), and disables the SDK-native equivalent.

    The returned object is a shallow copy — the original is not mutated.
    """
    if "ask_user" not in enabled:
        return options

    # mcp_servers can be dict | str | Path in the SDK. We can only merge
    # into the dict form; file-based configs keep their value unchanged
    # and the builtin server is skipped.
    mcp_servers = options.mcp_servers
    if mcp_servers is None or isinstance(mcp_servers, dict):
        mcp_servers = {**(mcp_servers or {}), _SERVER_NAME: _server}

    allowed = options.allowed_tools
    if allowed:
        allowed = list(allowed) + [ASK_USER_TOOL]

    disallowed = list(options.disallowed_tools) if options.disallowed_tools else []
    if "AskUserQuestion" not in disallowed:
        disallowed.append("AskUserQuestion")

    return replace(
        options,
        mcp_servers=mcp_servers,
        allowed_tools=allowed,
        disallowed_tools=disallowed,
    )
