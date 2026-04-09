"""
agentscript_to_sdk.py

A *very small* transpiler from a subset of Salesforce Agent Script
(YAML-style, indentation-based, `@` references) to a Claude Agent SDK
agent definition in Python.

Supported Agent Script subset
-----------------------------
agent:
   name: <str>
   description: <str>

variables:
   <var_name>:
      type: <number|text|boolean>
      description: <str>

actions:
   <action_name>:
      description: <str>
      inputs: { <name>: <type>, ... }      # optional

topics:
   <topic_name>:
      description: <str>
      instruction: <natural-language prompt for the LLM>
      reasoning:                           # deterministic logic, line-based
         - if <python-ish condition using @vars.X / @outputs.X>
         -    run @actions.<name>(arg=..., ...)
         -    set @vars.<name> = <expr>
         -    respond "<message>"
         - else
         -    ...
         - instruction "<extra prompt text passed to LLM when reached>"

Output
------
A single Python file that uses `claude_agent_sdk`:
  * one `@tool` stub per Agent Script action
  * a system prompt assembled from agent + topic descriptions/instructions
  * one deterministic `topic_<name>()` function per topic that mirrors the
    reasoning block (the "hybrid reasoning" half that Agent Script enforces
    in code rather than prompts)
  * a `main()` that runs the agent loop via `query()`

This is deliberately minimal (YAGNI): no full grammar, no type checking,
just enough to demonstrate the mapping Agentforce -> Agent SDK.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field

import yaml


# ---------------------------------------------------------------------------
# Intermediate representation
# ---------------------------------------------------------------------------

@dataclass
class Action:
    name: str
    description: str = ""
    inputs: dict[str, str] = field(default_factory=dict)


@dataclass
class Topic:
    name: str
    description: str = ""
    instruction: str = ""
    reasoning: list[str] = field(default_factory=list)  # raw lines


@dataclass
class AgentScript:
    name: str = "Agent"
    description: str = ""
    variables: dict[str, dict] = field(default_factory=dict)
    actions: dict[str, Action] = field(default_factory=dict)
    topics: dict[str, Topic] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Parse: Agent Script (YAML-ish) -> IR
# ---------------------------------------------------------------------------

def parse_agentscript(source: str) -> AgentScript:
    doc = yaml.safe_load(source) or {}
    spec = AgentScript()

    agent = doc.get("agent", {})
    spec.name = agent.get("name", "Agent")
    spec.description = agent.get("description", "")

    for vname, vmeta in (doc.get("variables") or {}).items():
        spec.variables[vname] = vmeta or {}

    for aname, ameta in (doc.get("actions") or {}).items():
        ameta = ameta or {}
        spec.actions[aname] = Action(
            name=aname,
            description=ameta.get("description", ""),
            inputs=ameta.get("inputs") or {},
        )

    for tname, tmeta in (doc.get("topics") or {}).items():
        tmeta = tmeta or {}
        reasoning = tmeta.get("reasoning") or []
        if isinstance(reasoning, str):
            reasoning = [ln for ln in reasoning.splitlines() if ln.strip()]
        spec.topics[tname] = Topic(
            name=tname,
            description=tmeta.get("description", ""),
            instruction=tmeta.get("instruction", ""),
            reasoning=[str(ln) for ln in reasoning],
        )

    return spec


# ---------------------------------------------------------------------------
# Reasoning-line -> Python translation
# ---------------------------------------------------------------------------

_REF = re.compile(r"@(vars|outputs|actions)\.([A-Za-z_][A-Za-z0-9_]*)")


def _subst_refs(expr: str) -> str:
    """Replace @vars.x / @outputs.x / @actions.x with Python identifiers."""
    def repl(m: re.Match) -> str:
        kind, name = m.group(1), m.group(2)
        if kind == "vars":
            return f'vars["{name}"]'
        if kind == "outputs":
            return f'outputs["{name}"]'
        if kind == "actions":
            return name  # bare function name
        return m.group(0)
    return _REF.sub(repl, expr)


def _translate_stmt(stmt: str) -> str:
    """Translate a single non-control reasoning statement (no indent)."""
    if stmt.startswith("run "):
        call = _subst_refs(stmt[4:])
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\s*\(", call)
        target = m.group(1) if m else "result"
        return f'outputs["{target}"] = await {call}'
    if stmt.startswith("set "):
        return _subst_refs(stmt[4:])
    if stmt.startswith("respond "):
        return f"return {_subst_refs(stmt[len('respond '):].strip())}"
    if stmt.startswith("instruction "):
        return f"extra_instructions.append({stmt[len('instruction '):].strip()})"
    return f"# {stmt}"


def translate_reasoning(lines: list[str], base_indent: str = "    ") -> list[str]:
    """Translate a reasoning block to Python lines.

    Control flow (`if`/`elif`/`else`/`end`) is tracked with a depth counter
    rather than source whitespace, since YAML list items strip leading spaces.
    Supports linear (non-nested) if/elif/else; nested blocks need explicit
    `end` markers.
    """
    out: list[str] = []
    depth = 0

    def emit(code: str) -> None:
        out.append(base_indent + ("    " * depth) + code)

    for raw in lines:
        stmt = raw.strip()
        if not stmt:
            continue
        if stmt.startswith("if "):
            emit(f"if {_subst_refs(stmt[3:]).rstrip(':')}:")
            depth += 1
        elif stmt.startswith("elif "):
            depth = max(depth - 1, 0)
            emit(f"elif {_subst_refs(stmt[5:]).rstrip(':')}:")
            depth += 1
        elif stmt in ("else", "else:"):
            depth = max(depth - 1, 0)
            emit("else:")
            depth += 1
        elif stmt == "end":
            depth = max(depth - 1, 0)
        else:
            emit(_translate_stmt(stmt))

    return out


# ---------------------------------------------------------------------------
# Emit: IR -> Claude Agent SDK Python source
# ---------------------------------------------------------------------------

_TYPE_MAP = {"number": "float", "text": "str", "string": "str", "boolean": "bool"}


def emit_sdk(spec: AgentScript) -> str:
    out: list[str] = []
    w = out.append

    w('"""Auto-generated from Agent Script. Do not edit by hand."""')
    w("from __future__ import annotations")
    w("import anyio")
    w("from claude_agent_sdk import query, tool, ClaudeAgentOptions, create_sdk_mcp_server")
    w("")

    # ---- variables ------------------------------------------------------
    w("# Conversation-scoped variables (Agent Script `variables:` block)")
    inits = ", ".join(f'"{n}": None' for n in spec.variables) or ""
    w(f"vars: dict = {{{inits}}}")
    w("outputs: dict = {}")
    w("")

    # ---- actions -> @tool stubs ----------------------------------------
    for a in spec.actions.values():
        schema = {n: {"type": t} for n, t in a.inputs.items()}
        params = ", ".join(
            f"{n}: {_TYPE_MAP.get(t, 'str')}" for n, t in a.inputs.items()
        )
        w(f'@tool("{a.name}", "{a.description or a.name}", {schema!r})')
        w(f"async def {a.name}({params}):")
        w(f'    """TODO: implement (was Agentforce action `{a.name}`)."""')
        w("    raise NotImplementedError")
        w("")

    # ---- topics -> deterministic handlers ------------------------------
    for t in spec.topics.values():
        w(f"async def topic_{t.name}() -> str | None:")
        w(f'    """{t.description or t.name}"""')
        w("    extra_instructions: list[str] = []")
        if t.reasoning:
            out.extend(translate_reasoning(t.reasoning))
        else:
            w("    pass")
        w("    return None")
        w("")

    # ---- system prompt -------------------------------------------------
    prompt_parts = [spec.description] if spec.description else []
    for t in spec.topics.values():
        prompt_parts.append(f"## Topic: {t.name}\n{t.instruction}")
    system_prompt = "\n\n".join(p for p in prompt_parts if p)
    w("SYSTEM_PROMPT = " + repr(system_prompt))
    w("")

    # ---- main ----------------------------------------------------------
    tool_list = ", ".join(spec.actions) or ""
    topic_map = ", ".join(f'"{n}": topic_{n}' for n in spec.topics)
    w("TOPIC_HANDLERS = {" + topic_map + "}")
    w("")
    w("async def main(user_message: str) -> None:")
    w("    server = create_sdk_mcp_server(")
    w(f'        name="{spec.name}_actions",')
    w(f"        tools=[{tool_list}],")
    w("    )")
    w("    options = ClaudeAgentOptions(")
    w("        system_prompt=SYSTEM_PROMPT,")
    w('        mcp_servers={"actions": server},')
    w("    )")
    w("    async for msg in query(prompt=user_message, options=options):")
    w("        print(msg)")
    w("")
    w('if __name__ == "__main__":')
    w('    import sys as _sys')
    w('    anyio.run(main, _sys.argv[1] if len(_sys.argv) > 1 else "hello")')

    return "\n".join(out) + "\n"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def convert(path_in: str, path_out: str) -> None:
    with open(path_in, "r", encoding="utf-8") as f:
        spec = parse_agentscript(f.read())
    code = emit_sdk(spec)
    with open(path_out, "w", encoding="utf-8") as f:
        f.write(code)
    print(f"wrote {path_out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: python agentscript_to_sdk.py <input.ascript> <output.py>")
        sys.exit(1)
    convert(sys.argv[1], sys.argv[2])
