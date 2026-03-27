"""AgentSession — owns the ClaudeSDKClient lifecycle, independent of any WebSocket.

A WebSocket is just a *viewer* that attaches/detaches. The agent run outlives
the WS: `process_query` runs as a background task, writes to jsonl always, and
writes to the attached WS if there is one. When no viewer is attached and the
agent is idle, the SDK client is torn down (cheap to reconnect via options.resume).
"""

import asyncio
import time
from pathlib import Path
from typing import Any

from fastapi import WebSocket

from claude_agent_sdk import ClaudeSDKClient, ResultMessage

from .types import AgentFactory
from .sandbox import apply_sandbox
from .session import SessionStore
from .serialization import message_to_ws_payload
from .utils.console_logger import print_activity
from .utils.usage_tracker import UsageTracker


class AgentSession:
    """Agent lifecycle for one session. WebSocket-agnostic."""

    def __init__(
        self,
        session_id: str,
        agent_factory: AgentFactory,
        config: dict[str, Any],
    ):
        self.agent_factory = agent_factory
        self.agent_name = config.get("agent_name", "Agent")
        self.subagent_name = config.get("subagent_name", "Subagent")
        self.sandbox = config.get("sandbox", True)
        sessions_dir = config.get("sessions_dir", Path("./sessions"))

        self.session_store = SessionStore(session_id, sessions_dir)
        self.session_store.create()

        self.ws: WebSocket | None = None
        self.client: ClaudeSDKClient | None = None
        self.usage = UsageTracker()
        self._title_generated = False
        self._processing = False
        self._task: asyncio.Task | None = None
        self._background_tasks: set[asyncio.Task] = set()
        # Task tool_use_id → (description, subagent_type) so a subagent's
        # TodoWrite can be labelled with who actually wrote it.
        self._subagent_labels: dict[str, tuple[str | None, str | None]] = {}

    def attach(self, ws: WebSocket) -> None:
        self.ws = ws

    def detach(self, ws: WebSocket) -> None:
        """Release the viewer. Tear down client if idle."""
        if self.ws is ws:
            self.ws = None
            if not self._processing:
                asyncio.create_task(self._teardown_client())

    async def _teardown_client(self) -> None:
        if self.client:
            try:
                await self.client.disconnect()
            except Exception:
                pass
            self.client = None

    async def ensure_client(self) -> None:
        """Lazily (re)connect the SDK client, resuming from metadata if present."""
        if self.client is not None:
            return
        options = self.agent_factory()
        if self.sandbox:
            enforce = self.sandbox != "permissive"
            options = apply_sandbox(
                options, self.session_store.sandbox_path, enforce=enforce
            )
        meta = self.session_store.get_info()
        if meta.get("sdk_session_id"):
            options.resume = meta["sdk_session_id"]
            self._title_generated = True
        self.client = ClaudeSDKClient(options)
        await self.client.connect()

    async def send_json(self, data: dict):
        if self.ws is not None:
            try:
                await self.ws.send_json(data)
            except Exception:
                self.ws = None

    async def send_error(self, message: str):
        await self.send_json({"type": "error", "message": message})

    def _record_task_dispatches(self, msg: Any) -> None:
        """Capture Task tool_use_id → (description, subagent_type) for attribution."""
        if type(msg).__name__ != "AssistantMessage":
            return
        for block in msg.content:
            if type(block).__name__ == "ToolUseBlock" and block.name == "Task":
                tool_input = block.input if isinstance(block.input, dict) else {}
                desc = tool_input.get("description")
                stype = tool_input.get("subagent_type")
                if desc or stype:
                    self._subagent_labels[block.id] = (desc, stype)

    def extract_todos_from_message(self, msg: Any) -> dict | None:
        """Extract todos from a TodoWrite tool call if present."""
        msg_type = type(msg).__name__
        if msg_type != "AssistantMessage":
            return None

        parent_tool_use_id = getattr(msg, 'parent_tool_use_id', None)
        for block in msg.content:
            if type(block).__name__ == "ToolUseBlock" and block.name == "TodoWrite":
                tool_input = block.input if isinstance(block.input, dict) else {}
                todos = tool_input.get("todos", [])
                if todos:
                    if parent_tool_use_id:
                        desc, stype = self._subagent_labels.get(parent_tool_use_id, (None, None))
                        # "knowledge-management" -> "Knowledge Management Subagent"
                        if stype:
                            name = f"{stype.replace('-', ' ').replace('_', ' ').title()} Subagent"
                        else:
                            name = self.subagent_name
                        return {"todos": todos, "agent_id": parent_tool_use_id, "agent_name": name, "task": desc}
                    else:
                        return {"todos": todos, "agent_id": "main", "agent_name": self.agent_name}
        return None

    async def _generate_and_send_title(self, query: str, title_generator):
        """Generate session title in the background."""
        try:
            title = await title_generator(query)
            self.session_store.set_title(title)
            await self.send_json({
                "type": "session_title_updated",
                "session_id": self.session_store.session_id,
                "title": title,
            })
        except Exception as e:
            print(f"Failed to generate session title: {e}")

    async def process_query(self, query: str, title_generator=None):
        """Process a user query and stream responses."""
        self._processing = True
        start_time = time.time()

        try:
            await self.ensure_client()
        except Exception as e:
            await self.send_error(f"Failed to initialize session: {e}")
            self._processing = False
            return

        # Derive first-message from durable state, don't track separately.
        is_first = self.session_store.get_info().get("sdk_session_id") is None

        if is_first and not self._title_generated and title_generator:
            self._title_generated = True
            task = asyncio.create_task(self._generate_and_send_title(query, title_generator))
            self._background_tasks.add(task)
            task.add_done_callback(self._background_tasks.discard)

        # Log the user's message so session restore can display it
        self.session_store.append_message({
            "type": "user",
            "content": query,
            "parent_tool_use_id": None,
        })

        try:
            assert self.client is not None  # ensure_client() succeeded above
            await self.client.query(query)
            async for msg in self.client.receive_response():
                print_activity(msg)

                # Record Task dispatches BEFORE todo extraction so subagent
                # TodoWrites (which arrive in later messages) can be attributed.
                self._record_task_dispatches(msg)

                # Check for todo updates
                todo_info = self.extract_todos_from_message(msg)
                if todo_info:
                    todo_payload = {"type": "todo_update", **todo_info}
                    await self.send_json(todo_payload)
                    self.session_store.append_message(todo_payload)

                parent_tool_use_id = getattr(msg, 'parent_tool_use_id', None)

                # Track usage from ResultMessage
                if isinstance(msg, ResultMessage):
                    self.usage.update(msg)
                    await self.send_json({
                        "type": "usage_updated",
                        "usage": self.usage.to_dict(),
                    })
                    self.session_store.update_from_result(msg)

                payload = message_to_ws_payload(msg, parent_tool_use_id)
                if payload:
                    await self.send_json(payload)
                    self.session_store.append_message(payload)
        except Exception as e:
            await self.send_error(f"Agent error: {str(e)}")
        finally:
            self._processing = False
            elapsed = time.time() - start_time
            print(f"--- Query completed in {elapsed:.1f}s ({self.session_store.session_id}) ---")
            if self.ws is None:
                await self._teardown_client()
