"""ADLC Builder agent factory.

Wraps the Agentforce ADLC toolchain (skills, subagents, helper scripts)
in a Claude Agent SDK options object so it can be driven from the web UI
or CLI instead of Claude Code.

Skills and subagents are **referenced** from the parent repo via the
`.claude/` symlinks — edits to ``../../skills/`` or ``../../agents/``
flow through automatically.  The harness sandbox auto-whitelists
``<cwd>/.claude/`` for read-only access, so SKILL.md reference docs and
helper scripts stay reachable while the session's writes are confined
to its own sandbox directory.
"""

from __future__ import annotations

import re
from pathlib import Path

from claude_agent_sdk import AgentDefinition, ClaudeAgentOptions

# Repo root — three levels up from this file
#   web_app_example/examples/adlc-builder/agent.py → agentforce-adlc/
ADLC_ROOT = Path(__file__).resolve().parents[3]
AGENTS_DIR = ADLC_ROOT / "agents"


_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)


def _load_subagents() -> dict[str, AgentDefinition]:
    """Parse ``agents/*.md`` into AgentDefinition objects.

    The .md files use YAML-ish frontmatter (name, description, tools) followed
    by the agent's system prompt.  Referencing them at runtime means edits to
    the source files take effect on the next session without a rebuild.
    """
    agents: dict[str, AgentDefinition] = {}
    for md in sorted(AGENTS_DIR.glob("*.md")):
        m = _FRONTMATTER_RE.match(md.read_text())
        if not m:
            continue
        fm, body = m.groups()
        meta: dict[str, str] = {}
        for line in fm.splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        name = meta.get("name", md.stem)
        # Tool lists can include "Task(foo, bar)" — strip parentheticals before
        # splitting so the inner commas don't produce bogus entries.
        tools_raw = re.sub(r"\([^)]*\)", "", meta.get("tools", ""))
        tools = [t.strip() for t in tools_raw.split(",") if t.strip()]
        tools = ["Agent" if t == "Task" else t for t in tools]
        agents[name] = AgentDefinition(
            description=meta.get("description", ""),
            prompt=body.strip(),
            tools=tools or None,
        )
    return agents


SYSTEM_PROMPT = f"""\
You are the **ADLC Builder** — a conversational front end for the Agentforce
Agent Development Life Cycle.  You help users go from requirements to a
deployed, tested Agentforce agent without leaving the chat.

## Repository

The ADLC toolchain lives at: {ADLC_ROOT}

- `skills/` — SKILL.md instructions for each lifecycle phase (author, discover,
  scaffold, deploy, run, test, optimize, safety).  Load these via the Skill
  tool when a task matches.
- `agents/` — specialist subagents you can delegate to via the Agent tool.
- `scripts/` — Python helpers (discover.py, scaffold.py, org_describe.py).
  Run them with Bash.
- `CLAUDE.md` — project conventions and routing rules.  Read it first.

## Workflow

1. **Requirements** — gather what the agent should do, which org it targets,
   success criteria.
2. **Author** — generate the `.agent` file (use the adlc-author skill or
   delegate to the adlc-author subagent).
3. **Discover** — check which Flow/Apex/Retriever targets already exist.
4. **Scaffold** — generate stubs for missing targets.
5. **Deploy** — push metadata, publish the authoring bundle, activate.
6. **Test** — preview + batch test, analyse session traces.
7. **Optimize** — fix issues surfaced by testing.

Write Salesforce metadata (``.agent`` files, Flow XML, Apex) into
``force-app/main/default/`` so discover/scaffold/deploy can find them.
Also copy anything the user should download into your artifacts
directory so it shows up in the UI panel.
"""


def create_agent() -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        system_prompt=SYSTEM_PROMPT,
        model="claude-opus-4-6",
        cwd=str(ADLC_ROOT),
        setting_sources=["project"],  # load CLAUDE.md + .claude/skills
        allowed_tools=[
            "Read", "Write", "Edit", "Bash", "Grep", "Glob",
            "Agent", "Skill", "TodoWrite",
        ],
        agents=_load_subagents(),
        permission_mode="acceptEdits",
        add_dirs=[str(ADLC_ROOT)],
    )
