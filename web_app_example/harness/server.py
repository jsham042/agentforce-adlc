"""FastAPI WebSocket server for agent applications.

This module provides a reusable server infrastructure that works with any agent
defined as a factory function returning ClaudeAgentOptions. The harness owns the
ClaudeSDKClient lifecycle — agents just provide configuration.

Usage:
    from harness import create_app

    def create_my_agent() -> ClaudeAgentOptions:
        return ClaudeAgentOptions(
            system_prompt="You are helpful.",
            model="claude-sonnet-4-6",
        )

    # Sandbox isolation is applied automatically by the harness.
    app = create_app(create_my_agent, {
        "agent_name": "My Agent",
        "sessions_dir": Path("./sessions"),
    })
    uvicorn.run(app, host="0.0.0.0", port=8000)
"""

import asyncio
import json
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from .types import AgentFactory
from .session import SessionStore
from .websocket import AgentSession
from .mcp_apps import discover_tool_apps
from .builtin_tools import apply_builtin_tools, DEFAULT_BUILTINS

load_dotenv()

# Session IDs must match this pattern to prevent path traversal.
# Server-generated IDs are always "session_YYYYMMDD_HHMMSS"; this regex
# also permits the K8s gateway's microsecond variant and manually-created
# IDs that use only alphanumerics, hyphens, and underscores.
_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")


def _validate_session_id(session_id: str) -> str:
    """Validate a session ID and return it, or raise an HTTPException."""
    if not _SESSION_ID_RE.match(session_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid session_id: must be 1-128 alphanumeric/hyphen/underscore characters",
        )
    return session_id


async def generate_session_title(query: str) -> str:
    """Generate a short title for a session based on the first query."""
    try:
        client = anthropic.AsyncAnthropic()
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=30,
            messages=[{
                "role": "user",
                "content": f"Generate a concise 3-6 word title for a conversation that starts with this message. Reply with ONLY the title, no quotes or punctuation:\n\n{query[:500]}"
            }]
        )
        title = response.content[0].text.strip().strip('"\'')
        return title[:60]
    except Exception:
        return query[:40] + ("..." if len(query) > 40 else "")


def create_app(
    agent_factory: AgentFactory,
    config: dict[str, Any],
) -> FastAPI:
    """Create a FastAPI application for the given agent factory.

    Args:
        agent_factory: A function () -> ClaudeAgentOptions that returns agent
            configuration. Called once per session (and once at startup for
            MCP Apps discovery).
        config: Configuration dictionary:
            - agent_name (str): Display name for the main agent (default: "Agent")
            - subagent_name (str): Display name for subagents (default: "Subagent")
            - sessions_dir (Path): Directory for session storage (default: "./sessions")
            - ui_dist_dir (Path, optional): Directory for static UI files
            - title (str, optional): FastAPI app title
            - starter_prompts (list[dict], optional): List of starter prompts shown
              in the empty state UI. Each dict has "title" (str) and "prompt" (str).
            - on_session_create (Callable[[Path], None], optional): Called with the
              sandbox path the first time a session is created. Use to pre-seed
              files into the agent's workspace.
            - builtin_tools (list[str], optional): Harness-provided tools to
              auto-inject. Defaults to ``["ask_user"]``. Pass ``[]`` to disable.

    Returns:
        Configured FastAPI application ready to run with uvicorn.
    """
    agent_name = config.get("agent_name", "Agent")
    sessions_dir = config.get("sessions_dir", Path("./sessions"))
    default_ui_dist = Path(__file__).resolve().parent / "static"
    ui_dist_dir = config.get("ui_dist_dir", default_ui_dist)
    app_title = config.get("title", f"{agent_name} Server")
    starter_prompts = config.get("starter_prompts", [])
    on_session_create = config.get("on_session_create")

    # Wrap the factory so builtin tools are injected everywhere the factory
    # is called — both the startup discovery pass and per-session client init.
    builtin_tools = config.get("builtin_tools", DEFAULT_BUILTINS)
    if builtin_tools:
        base_factory = agent_factory
        def agent_factory():
            return apply_builtin_tools(base_factory(), builtin_tools)

    def _new_store(session_id: str) -> SessionStore:
        """Create a SessionStore and fire the on_session_create hook if it's new."""
        store = SessionStore(session_id, sessions_dir)
        is_new = not store.exists()
        store.create()
        if is_new and on_session_create:
            on_session_create(store.sandbox_path)
        return store

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Discover MCP Apps at startup — call agent_factory once just to introspect.
        # This doesn't create an SDK client, just reads mcp_servers from the options.
        _options = agent_factory()
        tool_apps, mcp_resources = await discover_tool_apps(_options.mcp_servers or {})
        app.state.tool_apps = tool_apps
        app.state.mcp_resources = mcp_resources
        print(f"{agent_name} Server starting... ({len(tool_apps)} MCP App(s) discovered)")
        yield
        print(f"{agent_name} Server shutting down...")

    app = FastAPI(title=app_title, lifespan=lifespan)

    # CORS: restrict to localhost by default. Override with CORS_ORIGINS env var
    # (comma-separated) for production deployments behind a custom domain.
    cors_origins = os.environ.get("CORS_ORIGINS", "").split(",") if os.environ.get("CORS_ORIGINS") else [
        "http://localhost:3001",
        "http://localhost:8000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:8000",
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health():
        """Liveness/readiness probe for container orchestrators."""
        return {"status": "healthy"}

    @app.get("/api/config")
    async def get_config():
        return {"agent_name": agent_name, "starter_prompts": starter_prompts}

    # ---- REST API for session management ----

    @app.post("/api/sessions")
    async def create_session():
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        session_id = f"session_{timestamp}"
        _new_store(session_id)
        return {"session_id": session_id}

    @app.get("/api/sessions")
    async def list_sessions():
        return {"sessions": SessionStore.list_all(sessions_dir)}

    @app.get("/api/sessions/{session_id}")
    async def get_session(session_id: str):
        _validate_session_id(session_id)
        store = SessionStore(session_id, sessions_dir)
        if not store.exists():
            raise HTTPException(status_code=404, detail="Session not found")
        return {"session": store.get_info()}

    @app.delete("/api/sessions/{session_id}")
    async def delete_session(session_id: str):
        _validate_session_id(session_id)
        store = SessionStore(session_id, sessions_dir)
        if store.delete():
            agent_sessions.pop(session_id, None)
            return {"status": "ok"}
        raise HTTPException(status_code=404, detail="Session not found")

    @app.get("/api/sessions/{session_id}/artifacts")
    async def list_artifacts(session_id: str):
        _validate_session_id(session_id)
        store = SessionStore(session_id, sessions_dir)
        if not store.exists():
            raise HTTPException(status_code=404, detail="Session not found")

        artifacts = []
        if store.sandbox_path.exists():
            for f in sorted(store.sandbox_path.rglob("*")):
                if not f.is_file():
                    continue
                rel = f.relative_to(store.sandbox_path)
                artifacts.append({
                    "name": f.name,
                    "path": str(rel),
                    "size": f.stat().st_size,
                })
        return {"artifacts": artifacts}

    @app.post("/api/sessions/{session_id}/upload")
    async def upload_file(session_id: str, file: UploadFile):
        _validate_session_id(session_id)
        store = SessionStore(session_id, sessions_dir)
        if not store.exists():
            raise HTTPException(status_code=404, detail="Session not found")
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename")
        # Flatten to basename to prevent path traversal
        safe_name = Path(file.filename).name
        store.sandbox_path.mkdir(parents=True, exist_ok=True)
        dest = store.sandbox_path / safe_name
        content = await file.read()
        dest.write_bytes(content)
        return {"name": safe_name, "size": len(content)}

    def _resolve_artifact(session_id: str, file_path: str) -> Path:
        _validate_session_id(session_id)
        store = SessionStore(session_id, sessions_dir)
        if not store.exists():
            raise HTTPException(status_code=404, detail="Session not found")
        target = (store.sandbox_path / file_path).resolve()
        if not str(target).startswith(str(store.sandbox_path.resolve())):
            raise HTTPException(status_code=403, detail="Access denied")
        if not target.exists() or not target.is_file():
            raise HTTPException(status_code=404, detail="File not found")
        return target

    @app.get("/api/sessions/{session_id}/artifacts/{file_path:path}")
    async def read_artifact(session_id: str, file_path: str):
        target = _resolve_artifact(session_id, file_path)
        try:
            content = target.read_text()
        except (UnicodeDecodeError, ValueError):
            content = f"[binary file: {target.name}, {target.stat().st_size} bytes]"
        return {"content": content, "name": target.name, "path": file_path}

    @app.get("/api/sessions/{session_id}/artifacts-raw/{file_path:path}")
    async def read_artifact_raw(session_id: str, file_path: str):
        """Serve raw artifact bytes (for <img>, downloads, etc)."""
        target = _resolve_artifact(session_id, file_path)
        return FileResponse(target)

    # ---- MCP Apps endpoints ----

    @app.get("/api/mcp/tool-apps")
    async def get_tool_apps():
        """Tool name → resource URI mapping. Frontend fetches this on connect."""
        return {"tool_apps": app.state.tool_apps}

    @app.get("/api/mcp/resources/{uri:path}")
    async def get_mcp_resource(uri: str):
        """Serve MCP App HTML by URI (uri is url-encoded 'ui://...')."""
        decoded = unquote(uri)
        html = app.state.mcp_resources.get(decoded)
        if html is None:
            raise HTTPException(404, "Resource not found")
        return HTMLResponse(content=html)

    # ---- WebSocket endpoint ----

    # Agent lifecycle is decoupled from WS lifecycle. These live for the
    # server process; the WS is just a viewer that attaches/detaches.
    agent_sessions: dict[str, AgentSession] = {}

    def _get_or_create_session(session_id: str) -> AgentSession:
        if session_id not in agent_sessions:
            _new_store(session_id)  # fires on_session_create hook
            agent_sessions[session_id] = AgentSession(session_id, agent_factory, config)
        return agent_sessions[session_id]

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await websocket.accept()
        current: AgentSession | None = None

        try:
            while True:
                try:
                    data = await websocket.receive_text()
                    msg = json.loads(data)
                    msg_type = msg.get("type")

                    if msg_type == "resume":
                        sid = msg.get("session_id")
                        if not sid:
                            continue
                        if not _SESSION_ID_RE.match(sid):
                            await websocket.send_json({"type": "error", "message": "Invalid session_id"})
                            continue
                        if current:
                            current.detach(websocket)
                        sess = _get_or_create_session(sid)
                        # Send history BEFORE attaching so process_query (if
                        # running) can't interleave a live message ahead of
                        # the restore payload. Use raw websocket.send_json —
                        # sess.send_json would no-op, we haven't attached yet.
                        await websocket.send_json({
                            "type": "session_restored",
                            "session_id": sid,
                            "session": sess.session_store.get_info(),
                            "messages": sess.session_store.read_messages(),
                            "is_processing": sess._processing,
                        })
                        sess.attach(websocket)
                        current = sess

                    elif msg_type == "query":
                        sid = msg.get("session_id")
                        if not sid:
                            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                            sid = f"session_{timestamp}"
                        if not _SESSION_ID_RE.match(sid):
                            await websocket.send_json({"type": "error", "message": "Invalid session_id"})
                            continue
                        if current and current.session_store.session_id != sid:
                            current.detach(websocket)
                        sess = _get_or_create_session(sid)
                        sess.attach(websocket)
                        current = sess

                        if sess._processing:
                            await sess.send_error("Agent is still processing")
                            continue

                        content = msg.get("content", "").strip()
                        if not content:
                            continue

                        await sess.send_json({"type": "session_saved", "session_id": sid})
                        sess._task = asyncio.create_task(
                            sess.process_query(content, generate_session_title)
                        )

                except json.JSONDecodeError:
                    await websocket.send_json({"type": "error", "message": "Invalid JSON message"})

        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"WebSocket error: {e}")
        finally:
            if current:
                current.detach(websocket)

    # ---- Static file serving ----

    if ui_dist_dir and Path(ui_dist_dir).exists():
        @app.get("/")
        async def serve_index():
            return FileResponse(Path(ui_dist_dir) / "index.html")

        app.mount("/", StaticFiles(directory=str(ui_dist_dir), html=True), name="static")

    return app


def run_server(
    agent_factory: AgentFactory,
    config: dict[str, Any],
    host: str = "0.0.0.0",
    port: int = 8000,
) -> None:
    """Create and run the server with uvicorn."""
    import uvicorn
    app = create_app(agent_factory, config)
    uvicorn.run(app, host=host, port=port)
