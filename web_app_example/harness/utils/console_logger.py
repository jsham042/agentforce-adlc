from claude_agent_sdk import (
    AssistantMessage,
    UserMessage,
    ResultMessage,
    ToolUseBlock,
    ToolResultBlock,
    TextBlock,
    ThinkingBlock,
)


def format_tool_result(tool_name: str, content) -> str:
    """Format tool result for display, truncating long values."""
    if content is None:
        return ""

    # Handle string content
    if isinstance(content, str):
        text = content.strip()
        if not text:
            return ""
        # For file listings, count items
        lines = text.split("\n")
        if tool_name == "Glob":
            return f"{len(lines)} file(s)"
        elif tool_name == "Grep":
            return f"{len(lines)} match(es)"
        elif tool_name == "Read":
            return f"{len(lines)} lines"
        elif tool_name == "Bash":
            if len(lines) == 1 and len(text) < 60:
                return text
            return f"{len(lines)} lines"
        elif tool_name in ("WebSearch", "WebFetch"):
            return f"{len(text)} chars"
        # Default: show truncated first line
        first_line = lines[0][:60]
        if len(lines) > 1 or len(lines[0]) > 60:
            first_line += "..."
        return first_line

    # Handle list content (e.g., multiple content blocks)
    if isinstance(content, list):
        text_parts = []
        for item in content:
            if hasattr(item, "text"):
                text_parts.append(item.text)
            elif isinstance(item, dict) and "text" in item:
                text_parts.append(item["text"])
        if text_parts:
            combined = " ".join(text_parts)
            return combined[:60] + "..." if len(combined) > 60 else combined
        return f"{len(content)} item(s)"

    return str(content)[:60]


def format_tool_input(tool_name: str, input_data: dict) -> str:
    """Format tool input for display, truncating long values."""
    if tool_name == "Task":
        desc = input_data.get("description", "")
        return f'"{desc}"' if desc else ""
    elif tool_name == "Read":
        path = input_data.get("file_path", "")
        return path.split("/")[-1] if path else ""
    elif tool_name == "Write":
        path = input_data.get("file_path", "")
        return path.split("/")[-1] if path else ""
    elif tool_name == "Edit":
        path = input_data.get("file_path", "")
        return path.split("/")[-1] if path else ""
    elif tool_name == "Glob":
        return input_data.get("pattern", "")
    elif tool_name == "Grep":
        return input_data.get("pattern", "")[:40]
    elif tool_name == "Bash":
        cmd = input_data.get("command", "")
        return cmd[:50] + "..." if len(cmd) > 50 else cmd
    elif tool_name == "WebSearch":
        return input_data.get("query", "")[:40]
    elif tool_name == "WebFetch":
        url = input_data.get("url", "")
        return url[:50] + "..." if len(url) > 50 else url
    elif tool_name == "TodoWrite":
        todos = input_data.get("todos", [])
        lines = []
        for i, todo in enumerate(todos):
            marker = "+" if todo["status"] == "completed" else \
                     "*" if todo["status"] == "in_progress" else "-"
            lines.append(f"{marker} {i + 1}. {todo['content']}")
        return "\n".join(lines) if lines else ""
    return ""


# Track tool_use_id -> tool_name for correlating results
_tool_use_cache: dict[str, str] = {}


def get_subagent_prefix(parent_tool_use_id: str | None) -> str:
    """Return prefix for subagent messages."""
    return "  [subagent] " if parent_tool_use_id else ""


def print_activity(msg, flush: bool = True) -> None:
    """Print activity to console based on message type."""

    if isinstance(msg, AssistantMessage):
        prefix = get_subagent_prefix(msg.parent_tool_use_id)

        for block in msg.content:
            if isinstance(block, ToolUseBlock):
                # Cache tool name for result correlation
                _tool_use_cache[block.id] = block.name
                detail = format_tool_input(block.name, block.input)
                if detail:
                    print(f"{prefix}-> {block.name}: {detail}", flush=flush)
                else:
                    print(f"{prefix}-> {block.name}", flush=flush)

            elif isinstance(block, TextBlock):
                text = block.text.strip()
                if text:
                    for line in text.split("\n"):
                        print(f"{prefix}{line}", flush=flush)

            elif isinstance(block, ThinkingBlock):
                # Extended thinking - just indicate it's happening
                print(f"{prefix}(thinking...)", flush=flush)

            elif isinstance(block, ToolResultBlock):
                # Tool results in assistant message (unusual but handle it)
                status = "error" if block.is_error else "ok"
                print(f"{prefix}<- tool result [{status}]", flush=flush)

    elif isinstance(msg, UserMessage):
        prefix = get_subagent_prefix(msg.parent_tool_use_id)

        if isinstance(msg.content, str):
            # User text input
            print(f"{prefix}[user input received]", flush=flush)
        else:
            # Tool results
            for block in msg.content:
                if isinstance(block, ToolResultBlock):
                    tool_name = _tool_use_cache.pop(block.tool_use_id, "")
                    status = "x" if block.is_error else "+"
                    result_summary = format_tool_result(tool_name, block.content)
                    if block.is_error:
                        print(f"{prefix}<- {status} {tool_name} error: {result_summary}", flush=flush)
                    elif result_summary:
                        print(f"{prefix}<- {status} {tool_name}: {result_summary}", flush=flush)

    elif isinstance(msg, ResultMessage):
        # Final result
        print(f"\n{'='*50}", flush=flush)
        print(f"Completed in {msg.duration_ms/1000:.1f}s ({msg.num_turns} turns)", flush=flush)
        if msg.total_cost_usd:
            print(f"Cost: ${msg.total_cost_usd:.4f}", flush=flush)
        if msg.is_error:
            print(f"Error: {msg.result}", flush=flush)
        print(f"{'='*50}\n", flush=flush)
