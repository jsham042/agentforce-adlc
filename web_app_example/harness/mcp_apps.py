"""MCP Apps discovery — introspect MCP servers for UI resource declarations.

Tools link to HTML renderers via standard MCP protocol:
  1. Agent author registers a Resource with MIME ``text/html;profile=mcp-app``
  2. Tool's ``_meta.ui.resourceUri`` points to it
  3. Harness discovers this at startup and exposes to the frontend

No SDK patches needed — we call the ``mcp.server.Server`` handlers directly
since we have the server instances in ``ClaudeAgentOptions.mcp_servers``.
"""

from typing import Any

from claude_agent_sdk import McpSdkServerConfig
from mcp.types import (
    ListToolsRequest,
    ReadResourceRequest,
    ReadResourceRequestParams,
)


async def discover_tool_apps(mcp_servers: dict[str, Any]) -> tuple[dict[str, str], dict[str, str]]:
    """Query MCP servers for tool→resourceUri mappings and resource contents.

    Args:
        mcp_servers: The ClaudeAgentOptions.mcp_servers dict.

    Returns:
        (tool_apps, resources) where
        - tool_apps: {tool_name: resource_uri}  (tool_name includes mcp__<server>__ prefix)
        - resources: {resource_uri: html_content}
    """
    tool_apps: dict[str, str] = {}
    resources: dict[str, str] = {}

    for srv_name, srv in (mcp_servers or {}).items():
        server = srv.get("instance") if isinstance(srv, dict) else None
        if not server:
            continue

        # Discover tools with _meta.ui.resourceUri
        tools_handler = server.request_handlers.get(ListToolsRequest)
        if tools_handler:
            result = await tools_handler(ListToolsRequest(method="tools/list"))
            for t in result.root.tools:
                meta = t.meta or {}
                ui = meta.get("ui", {}) if isinstance(meta, dict) else {}
                uri = ui.get("resourceUri") if isinstance(ui, dict) else None
                if uri:
                    full_name = f"mcp__{srv_name}__{t.name}"
                    tool_apps[full_name] = uri

        # Fetch resource contents
        read_handler = server.request_handlers.get(ReadResourceRequest)
        if read_handler:
            uris_for_server = {
                u for n, u in tool_apps.items()
                if n.startswith(f"mcp__{srv_name}__")
            }
            for uri in uris_for_server:
                try:
                    res = await read_handler(
                        ReadResourceRequest(
                            method="resources/read",
                            params=ReadResourceRequestParams(uri=uri),  # type: ignore[arg-type]
                        )
                    )
                    if res.root.contents:
                        resources[uri] = res.root.contents[0].text or ""
                except Exception:
                    pass  # Resource handler not registered or errored — skip

    return tool_apps, resources


# Registry attached to server instance (MCP decorators REPLACE handlers, don't stack)
_APP_REGISTRY_ATTR = "_harness_mcp_apps"


def register_mcp_app_resource(
    server_dict: McpSdkServerConfig,
    tool_name: str,
    html: str,
    uri: str | None = None,
) -> None:
    """Convenience: register an HTML resource and link a tool to it.

    Wraps the agent author's boilerplate (list_resources + read_resource +
    list_tools wrapper) into one call. Safe to call multiple times per server —
    uses an internal registry since MCP decorators replace handlers on each call.

    Args:
        server_dict: The dict returned by ``create_sdk_mcp_server`` (has
            ``"name"`` and ``"instance"`` keys).
        tool_name: The tool name (without mcp__ prefix) to link.
        html: The HTML content to serve for this tool's UI.
        uri: Optional resource URI. Defaults to ``ui://<server>/<tool>.html``.
    """
    from mcp.server.lowlevel.helper_types import ReadResourceContents
    from mcp.types import Resource

    server = server_dict["instance"]
    srv_name = server_dict["name"]
    uri = uri or f"ui://{srv_name}/{tool_name}.html"

    # Accumulating registry on the server instance
    registry = getattr(server, _APP_REGISTRY_ATTR, None)
    first_call = registry is None
    if first_call:
        registry = {}  # {tool_name: (uri, html)}
        setattr(server, _APP_REGISTRY_ATTR, registry)
    registry[tool_name] = (uri, html)

    if not first_call:
        return  # Handlers already installed; they read from registry

    # Install handlers ONCE — they close over `registry`
    @server.list_resources()
    async def _list_resources():
        return [
            Resource(
                uri=u,
                name=f"{tn} app",
                mimeType="text/html;profile=mcp-app",
                description=f"UI for {tn}",
            )
            for tn, (u, _) in registry.items()
        ]

    @server.read_resource()
    async def _read_resource(req_uri):
        for _tn, (u, h) in registry.items():
            if str(req_uri) == u:
                return [ReadResourceContents(content=h, mime_type="text/html;profile=mcp-app")]
        raise ValueError(f"Unknown resource: {req_uri}")

    _orig = server.request_handlers[ListToolsRequest]

    async def _list_with_meta(req):
        result = await _orig(req)
        for t in result.root.tools:
            if t.name in registry:
                t.meta = {"ui": {"resourceUri": registry[t.name][0]}}
        return result

    server.request_handlers[ListToolsRequest] = _list_with_meta
