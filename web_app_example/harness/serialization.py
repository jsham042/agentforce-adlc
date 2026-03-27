"""WebSocket wire protocol — SDK message → JSON payload.

This module defines the exact shape of WebSocket payloads sent to the frontend.
The same payloads are logged to ``sessions/<id>/messages.jsonl`` for session
restore, so these functions are the canonical serialization layer.

Message types on the wire:
  - {"type": "assistant", "content": [...], "model": ..., "parent_tool_use_id": ...}
  - {"type": "user", "content": "..." | [...], "parent_tool_use_id": ...}
  - {"type": "result", "subtype": ..., "duration_ms": ..., "num_turns": ..., ...}

Content block types:
  - {"type": "text", "text": "..."}
  - {"type": "thinking", "thinking": "..."}
  - {"type": "tool_use", "id": ..., "name": ..., "input": {...}}
  - {"type": "tool_result", "tool_use_id": ..., "content": ..., "is_error": ...}
"""

from typing import Any


def content_block_to_dict(block: Any) -> dict | None:
    """Convert a content block to a WebSocket-friendly dict."""
    block_type = type(block).__name__

    if block_type == "TextBlock":
        return {"type": "text", "text": block.text}
    elif block_type == "ThinkingBlock":
        return {"type": "thinking", "thinking": block.thinking}
    elif block_type == "ToolUseBlock":
        return {
            "type": "tool_use",
            "id": block.id,
            "name": block.name,
            "input": block.input if isinstance(block.input, dict) else str(block.input),
        }
    elif block_type == "ToolResultBlock":
        content = block.content
        if isinstance(content, list):
            content = [
                c if isinstance(c, dict) else {"type": "text", "text": str(c)}
                for c in content
            ]
        return {
            "type": "tool_result",
            "tool_use_id": block.tool_use_id,
            "content": content,
            "is_error": getattr(block, 'is_error', False),
        }
    return None


def message_to_ws_payload(msg: Any, parent_tool_use_id: str | None = None) -> dict | None:
    """Convert an SDK message to a WebSocket payload dict."""
    msg_type = type(msg).__name__

    if msg_type == "AssistantMessage":
        content = []
        for block in msg.content:
            block_dict = content_block_to_dict(block)
            if block_dict:
                content.append(block_dict)

        return {
            "type": "assistant",
            "content": content,
            "model": getattr(msg, "model", None),
            "parent_tool_use_id": parent_tool_use_id,
        }

    elif msg_type == "UserMessage":
        raw = getattr(msg, "content", "")
        if isinstance(raw, str):
            content = raw
        else:
            content = []
            for block in raw:
                block_dict = content_block_to_dict(block)
                if block_dict:
                    content.append(block_dict)

        return {
            "type": "user",
            "content": content,
            "parent_tool_use_id": getattr(msg, "parent_tool_use_id", None),
        }

    elif msg_type == "ResultMessage":
        return {
            "type": "result",
            "subtype": getattr(msg, "subtype", ""),
            "duration_ms": getattr(msg, "duration_ms", 0),
            "duration_api_ms": getattr(msg, "duration_api_ms", 0),
            "is_error": getattr(msg, "is_error", False),
            "num_turns": getattr(msg, "num_turns", 0),
            "session_id": getattr(msg, "session_id", ""),
            "total_cost_usd": getattr(msg, "total_cost_usd", None),
            "usage": getattr(msg, "usage", None),
            "result": getattr(msg, "result", None),
        }

    # SystemMessage (init/status noise) falls through — UI has never displayed it.
    return None
