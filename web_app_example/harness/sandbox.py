"""Sandbox isolation for agent options.

Restricts ClaudeAgentOptions so that agents can only access files inside
a designated sandbox directory.  All filesystem tools (Read, Write, Edit,
MultiEdit, NotebookEdit, Grep, Glob, LS) are covered by a single catch-all
PreToolUse hook.  This is the single place where sandbox instructions,
hooks, and subagent prompts are wired up — individual agent factories
should not duplicate this.
"""

from dataclasses import replace
from pathlib import Path

from claude_agent_sdk import AgentDefinition, ClaudeAgentOptions, SandboxSettings
from claude_agent_sdk.types import (
    HookInput,
    HookContext,
    HookJSONOutput,
    PreToolUseHookInput,
    HookMatcher,
)

from .transcript import sdk_project_dir


def _deny(reason: str) -> HookJSONOutput:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def _is_under(path: str, root: str) -> bool:
    """Check whether *path* resolves to somewhere inside *root*."""
    resolved = str(Path(path).resolve())
    return resolved == root or resolved.startswith(root + "/")


# ---------------------------------------------------------------------------
# Path validator — covers all built-in filesystem tools
# ---------------------------------------------------------------------------

# All Claude Code built-in tools that take a filesystem path.  Matched as a
# regex (full-match semantics) against the tool name.  Keep this list in sync
# if new filesystem tools are added to Claude Code.
_WRITE_TOOLS = frozenset(("Write", "Edit", "MultiEdit", "NotebookEdit"))
_READ_TOOLS = frozenset(("Read", "Grep", "Glob", "LS"))
_FS_TOOLS = "|".join(_WRITE_TOOLS | _READ_TOOLS)

# Parameter names those tools use to reference paths:
#   Write/Edit/MultiEdit/Read → file_path
#   NotebookEdit              → notebook_path
#   Grep/Glob/LS              → path
_PATH_PARAMS = ("file_path", "notebook_path", "path")


def _create_path_validator(sandbox_path: Path, readonly_dirs: list[str]) -> HookMatcher:
    """Deny any tool call whose path parameter resolves outside the sandbox.

    Read-only tools (Read/Grep/Glob/LS) are additionally allowed on
    *readonly_dirs* — used for skill reference docs that live outside
    the sandbox but must stay readable.
    """
    sandbox_str = str(sandbox_path.resolve())

    async def validate(
        hook_input: HookInput,
        _tool_use_id: str | None,
        _context: HookContext,
    ) -> HookJSONOutput:
        if not isinstance(hook_input, dict) or hook_input.get("hook_event_name") != "PreToolUse":
            return {}

        pre_tool: PreToolUseHookInput = hook_input  # type: ignore
        tool_name = pre_tool.get("tool_name", "")
        tool_input = pre_tool.get("tool_input", {})

        for param in _PATH_PARAMS:
            value = tool_input.get(param)
            if not value or _is_under(value, sandbox_str):
                continue
            # Write tools never get a pass. Read tools may hit readonly_dirs.
            if tool_name in _READ_TOOLS and any(_is_under(value, d) for d in readonly_dirs):
                continue
            return _deny(
                f"{param}='{value}' is outside the sandbox. "
                f"File operations are restricted to: {sandbox_str}"
            )
        return {}

    return HookMatcher(matcher=_FS_TOOLS, hooks=[validate])


_SANDBOX_INSTRUCTIONS_TEMPLATE = """

## Sandbox
Your sandbox directory is: {sandbox_path}
All file operations (read, write, search) MUST stay inside this directory.
Do not reference paths outside the sandbox.
"""

_ARTIFACTS_INSTRUCTIONS_TEMPLATE = """

## Artifacts
Your session's artifacts directory is: {sandbox_path}
Files written here appear in the UI's Artifacts panel. Use it for
generated outputs you want the user to download (reports, .agent files,
XML stubs). You are NOT confined to this directory — write elsewhere
when the task requires it.
"""

_READONLY_INSTRUCTIONS_TEMPLATE = """
Additionally, you have READ-ONLY access to: {readonly_dirs}
(skill reference docs and scripts — do not write here)
"""


def apply_sandbox(
    options: ClaudeAgentOptions,
    sandbox_path: Path,
    *,
    enforce: bool = True,
) -> ClaudeAgentOptions:
    """Apply sandbox isolation to agent options.

    1. Appends sandbox instructions to the system prompt (and to every
       subagent prompt in ``options.agents``).
    2. Adds *sandbox_path* to ``add_dirs`` so the SDK permits access
       to it without changing ``cwd`` (changing ``cwd`` would break
       session resume — the SDK keys its project dir off ``cwd``).
    3. Auto-detects ``<cwd>/.claude`` and whitelists it for READ-ONLY
       access — so skills can point the agent at their reference docs
       and helper scripts without tripping the path validator.
    4. Merges a ``PreToolUse`` hook that denies file access outside the
       sandbox — a path validator covering all built-in filesystem
       tools.

    The returned object is a shallow copy — the original is not mutated.

    Args:
        options: Base agent options (unchanged).
        sandbox_path: Directory the agent is confined to.
        enforce: When ``False``, steps 1–2 still run (so the agent knows
            where to drop UI-surfaced artifacts and the SDK permits
            access) but steps 3–4 and the OS-level Bash sandbox are
            skipped.  The agent can then write anywhere.  Use this for
            dev-environment agents that need to edit the surrounding
            repo while still populating the Artifacts panel.

    Returns:
        A new ``ClaudeAgentOptions`` with sandbox enforcement applied.
    """
    resolved = str(sandbox_path.resolve())
    template = _SANDBOX_INSTRUCTIONS_TEMPLATE if enforce else _ARTIFACTS_INSTRUCTIONS_TEMPLATE
    instructions = template.format(sandbox_path=resolved)

    # --- readonly whitelist: auto-detect .claude/ relative to agent cwd ---
    # Skills load SKILL.md via the Skill tool, but SKILL.md often tells the
    # agent to Read <reference>.md or run <scripts>/foo.py — those paths live
    # under .claude/skills/<name>/ in the project dir, not in the sandbox.
    agent_cwd = Path(options.cwd) if options.cwd else Path.cwd()
    claude_dir = (agent_cwd / ".claude").resolve()
    readonly_dirs: list[str] = [str(claude_dir)] if claude_dir.is_dir() else []
    if readonly_dirs:
        instructions += _READONLY_INSTRUCTIONS_TEMPLATE.format(
            readonly_dirs=", ".join(readonly_dirs)
        )

    # The SDK spills oversized tool output to
    # ~/.claude/projects/<mangled>/<uuid>/tool-results/*.txt and tells the
    # agent to Read it back.  Whitelist the project dir so that Read passes.
    # (Not added to the prompt instructions — the agent never navigates here
    # proactively, it just follows the path the <persisted-output> hands it.)
    project_dir = sdk_project_dir(agent_cwd).resolve()
    if project_dir.is_dir():
        readonly_dirs.append(str(project_dir))

    # --- system prompt ---
    system_prompt = options.system_prompt or ""
    if isinstance(system_prompt, str):
        system_prompt += instructions

    # --- subagent prompts ---
    agents = None
    if options.agents:
        agents = {}
        for name, defn in options.agents.items():
            agents[name] = AgentDefinition(
                description=defn.description,
                prompt=defn.prompt + instructions,
                tools=defn.tools,
                model=defn.model,
            )

    # --- hooks (merge sandbox validator into PreToolUse) ---
    hooks = dict(options.hooks) if options.hooks else {}
    if enforce:
        path_validator = _create_path_validator(sandbox_path, readonly_dirs)
        existing = hooks.get("PreToolUse", [])
        hooks["PreToolUse"] = list(existing) + [path_validator]

    # --- native SDK sandbox (OS-level Bash command isolation) ---
    sandbox = dict(options.sandbox) if options.sandbox else {}
    if enforce:
        sandbox.setdefault("enabled", True)
        sandbox.setdefault("autoAllowBashIfSandboxed", True)
        sandbox.setdefault("allowUnsandboxedCommands", False)

    # Build a new options object with only the sandbox-related fields replaced.
    # dataclasses.replace() copies everything else automatically, so this
    # won't silently drop new fields when the SDK adds them.
    return replace(
        options,
        system_prompt=system_prompt,
        add_dirs=list(options.add_dirs) + [resolved],
        hooks=hooks,
        agents=agents if agents is not None else options.agents,
        sandbox=sandbox,
    )
