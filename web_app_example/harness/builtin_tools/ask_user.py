"""ask_user — present structured multiple-choice questions to the user.

Replaces the SDK's built-in AskUserQuestion tool, which assumes a CLI prompt
and doesn't render in the WebSocket + web UI setup. This tool pairs with an
MCP App (ask_user.html) that renders an interactive form in the chat.
"""

import json
from claude_agent_sdk import tool


def _text(s: str) -> dict:
    return {"content": [{"type": "text", "text": s}]}


def _parse_options(raw) -> list[str]:
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
        return [str(o) for o in parsed] if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


@tool(
    name="ask_user",
    description="""Present one or more multiple-choice clarification questions to the user.
    Pass `questions` as a JSON array of objects: [{"question": "...", "options": ["A", "B"]}].
    Each rendered question includes a free-text "Other" option and a Skip button, so do
    not add those yourself. For purely open-ended questions with no sensible options,
    do NOT use this tool — just ask in plain chat. The user's answers arrive as the next
    message, one line per question (skipped questions show "(skipped)").""",
    input_schema={
        "questions": {
            "type": "string",
            "description": 'JSON array of {"question": str, "options": [str]} objects',
        },
    },
)
async def ask_user(args: dict) -> dict:
    raw = args.get("questions", "[]")
    try:
        items = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        items = None

    if not isinstance(items, list) or not items:
        return _text(
            "Error: ask_user requires a non-empty `questions` array. "
            'Example: [{"question": "Which format?", "options": ["PDF", "Word"]}]'
        )

    questions = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            return _text(f"Error: questions[{i}] must be an object with 'question' and 'options'.")
        q = str(item.get("question", "")).strip()
        opts = _parse_options(item.get("options", []))
        if not q or not opts:
            return _text(
                f"Error: questions[{i}] needs a non-empty 'question' and at least one option."
            )
        questions.append({"question": q, "options": opts})

    payload = json.dumps({"questions": questions})
    lines = []
    for i, q in enumerate(questions, 1):
        opts = "\n".join(f"    - {o}" for o in q["options"])
        lines.append(f"Q{i}: {q['question']}\n{opts}")
    body = "\n\n".join(lines)

    noun = "question" if len(questions) == 1 else f"{len(questions)} questions"
    model_text = (
        f"Sent {noun} to user:\n\n{body}\n\n"
        f"Awaiting user response — do not proceed until they reply."
    )

    return _text(model_text + f"\n\n<!--DATA:{payload}-->")
