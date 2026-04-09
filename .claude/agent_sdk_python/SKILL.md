---
name: agent-sdk-python
description: Comprehensive reference for building with the Claude Agent SDK for Python. Use when writing, modifying, or debugging Agent SDK code in Python -- whether starting from scratch or working with an existing project. Covers core concepts (agents, tools, MCP servers, hooks, subagents, permissions, skills, structured outputs, slash commands, user input), code patterns, and best practices with links to official documentation.
---

# Claude Agent SDK for Python Reference

The Claude Agent SDK for Python is a Python SDK for building agentic applications
powered by Claude. It provides a programmatic interface for creating agents that can
use tools, delegate to subagents, enforce permissions, react to lifecycle events via
hooks, and integrate with external services through MCP servers.

The Python SDK mirrors the capabilities of the TypeScript SDK with idiomatic Python
APIs -- dataclasses instead of plain objects, async/await with asyncio, snake_case
naming, and type hints throughout.

## Official Documentation

| Feature | URL |
|---------|-----|
| Overview & Getting Started | https://platform.claude.com/docs/en/agent-sdk/overview |
| Custom Tools | https://platform.claude.com/docs/en/agent-sdk/custom-tools |
| MCP Servers | https://platform.claude.com/docs/en/agent-sdk/mcp |
| Subagents | https://platform.claude.com/docs/en/agent-sdk/subagents |
| Hooks | https://platform.claude.com/docs/en/agent-sdk/hooks |
| Permissions | https://platform.claude.com/docs/en/agent-sdk/permissions |
| Skills | https://platform.claude.com/docs/en/agent-sdk/skills |
| Structured Outputs | https://platform.claude.com/docs/en/agent-sdk/structured-outputs |
| Slash Commands | https://platform.claude.com/docs/en/agent-sdk/slash-commands |
| User Input (Human-in-the-Loop) | https://platform.claude.com/docs/en/agent-sdk/user-input |

---

## 1. Core Concepts

### 1.1 Agents and Queries

An agent is configured with a model, system prompt (instructions), and a set of
capabilities (tools, MCP servers, skills). You run an agent by issuing a **query**,
which is a conversation turn that Claude processes -- potentially making multiple
tool calls before returning a final response.

**Key query options:**

- `system_prompt` / `append_system_prompt` -- set or extend the agent's instructions
- `allowed_tools` -- whitelist of tools the agent can use (tool names or glob patterns)
- `disallowed_tools` -- blacklist specific tools
- `max_turns` -- cap the number of agentic turns (tool-use round-trips)
- `output_format` -- enforce structured JSON output (see Section 7)
- `mcp_servers` -- attach MCP servers (see Section 3)
- `hooks` -- attach lifecycle hooks (see Section 5)
- `permissions` -- configure permission rules (see Section 6)

### 1.2 Streaming

The SDK supports streaming responses via async iterators. When streaming, you receive
events as the agent works, including text deltas, tool use events, and result events.
This is important for building interactive UIs or real-time feedback loops.

```python
async for event in agent.query_stream(prompt="Summarize this document"):
    if event.type == "text_delta":
        print(event.text, end="", flush=True)
    elif event.type == "tool_use":
        print(f"\n[Using tool: {event.tool_name}]")
    elif event.type == "result":
        final_result = event.result
```

---

## 2. Custom Tools

Tools give agents the ability to take actions and retrieve information. There are two
main approaches to defining tools in the SDK.

### 2.1 In-Process Tools via `create_sdk_mcp_server()`

The recommended approach for tools defined in your own code. This creates an in-process
MCP server -- no external process, no network overhead.

```python
from claude_agent_sdk import create_sdk_mcp_server

def setup_tools(server):
    @server.tool(
        name="search_database",
        description="Search the product database by keyword",
        parameters={
            "query": {"type": "string", "description": "Search query"},
            "limit": {"type": "number", "description": "Max results to return"},
        },
    )
    async def search_database(query: str, limit: int = 10):
        results = await db.search(query, limit)
        return {"content": [{"type": "text", "text": json.dumps(results)}]}

    @server.tool(
        name="get_order_status",
        description="Look up the status of a customer order",
        parameters={
            "order_id": {"type": "string", "description": "The order ID"},
        },
    )
    async def get_order_status(order_id: str):
        order = await db.get_order(order_id)
        return {"content": [{"type": "text", "text": json.dumps(order)}]}

my_tools = create_sdk_mcp_server(setup_tools)
```

Then attach it to your query as an MCP server:

```python
response = await agent.query(
    prompt="Find laptops under $500",
    mcp_servers=[my_tools],
)
```

### 2.2 Tool Naming Convention

When tools come from MCP servers, the SDK names them using the pattern:

```
mcp__{server-name}__{tool-name}
```

Use this pattern in `allowed_tools` to reference specific MCP-provided tools:

```python
allowed_tools=["mcp__my-tools__search_database", "mcp__my-tools__get_order_status"]
```

You can also use glob patterns:

```python
allowed_tools=["mcp__my-tools__*"]  # all tools from my-tools server
```

### 2.3 Tool Input Schemas

Each tool has a name, description, and a set of parameters. Parameters have:

- `type` -- `string`, `number`, `boolean`, `array`, or `object`
- `description` -- what the parameter is for (helps Claude use the tool correctly)
- `required` -- whether the parameter is mandatory (defaults vary by framework)

Write clear, specific descriptions. Claude relies on them to decide when and how to
call your tools.

---

## 3. MCP Servers (Model Context Protocol)

MCP servers are external processes or services that expose tools to the agent over a
standardized protocol. They are the primary way to integrate third-party services,
databases, and APIs.

### 3.1 Transport Types

| Transport | When to Use | Notes |
|-----------|-------------|-------|
| `stdio` | Local development, CLI tools | Spawns a child process; communicates over stdin/stdout |
| `http` | Cloud deployment, remote services | HTTP-based; works across network boundaries |
| `sse` | Legacy/specific use cases | Server-sent events; less common |

### 3.2 stdio Transport (Local)

```python
import os

mcp_server = {
    "name": "my-db-server",
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@my-org/db-mcp-server"],
    "env": {
        "DATABASE_URL": os.environ["DATABASE_URL"],
    },
}
```

### 3.3 HTTP Transport (Cloud)

```python
mcp_server = {
    "name": "my-api-server",
    "transport": "http",
    "url": "https://mcp.my-service.com/v1",
}
```

### 3.4 Choosing a Transport

- Use **stdio** during local development and for tools that run on the same machine.
- Use **HTTP** for production deployments, cloud services, and when the MCP server
  runs on a different host.
- When building tools that are part of your application (not a separate service),
  prefer `create_sdk_mcp_server()` over either transport -- it avoids process/network
  overhead entirely.

---

## 4. Subagents

Subagents let you decompose complex tasks by delegating to specialized child agents.
Each subagent has its own model, instructions, and tool set.

### 4.1 Defining Subagents

A subagent is defined as a dictionary (or dataclass) with the agent definition fields:

```python
researcher = {
    "name": "researcher",
    "description": "Searches the web and summarizes findings",
    "model": "claude-sonnet-4-5-20250929",
    "instructions": (
        "You are a research assistant. Search for information and "
        "provide concise summaries with citations."
    ),
    "tools": ["mcp__web-search__search", "mcp__web-search__fetch"],
    # "inherit_tools": False  -- set True to inherit the parent's tools
}

code_writer = {
    "name": "code-writer",
    "description": "Writes and tests code based on specifications",
    "model": "claude-sonnet-4-5-20250929",
    "instructions": (
        "You are a senior engineer. Write clean, tested code "
        "following best practices."
    ),
    "tools": ["Bash", "Read", "Write", "Edit"],
}
```

### 4.2 Orchestrator-Workers Pattern

The most common multi-agent pattern: a coordinator agent that delegates to specialized
workers.

```python
coordinator = {
    "name": "coordinator",
    "model": "claude-sonnet-4-5-20250929",
    "instructions": (
        "You coordinate research and implementation tasks. "
        "Delegate research to the researcher and coding to the code-writer."
    ),
    "subagents": [researcher, code_writer],
}
```

### 4.3 When to Use Subagents

- The task has clearly separable concerns (research vs. coding vs. review).
- Different subtasks benefit from different models (Haiku for fast triage, Sonnet for
  coding, Opus for complex analysis).
- You want to limit tool access per subtask (researcher can search but not write files).
- Parallel execution would speed things up.

### 4.4 When NOT to Use Subagents

- The task is straightforward and a single agent can handle it.
- Adding subagents would just create coordination overhead without real benefit.
- The subtasks are tightly coupled and need shared context.

---

## 5. Hooks

Hooks are lifecycle callbacks that fire at specific points during agent execution.
Use them for logging, validation, transformation, access control, and side effects.

### 5.1 Available Hook Events

| Event | When It Fires | Common Uses |
|-------|---------------|-------------|
| `pre_tool_use` | Before a tool call executes | Validate inputs, block dangerous calls, modify parameters |
| `post_tool_use` | After a tool call succeeds | Log results, transform output, trigger side effects |
| `post_tool_use_failure` | After a tool call fails | Error handling, retry logic, alerting |
| `session_start` | When an agent session begins | Initialize state, load config |
| `session_end` | When an agent session ends | Cleanup, save state, send reports |
| `stop` | When the agent stops (completes or errors) | Final logging, notifications |
| `subagent_start` | Before a subagent starts | Validate delegation, inject context |
| `subagent_stop` | After a subagent finishes | Collect results, update parent state |
| `user_prompt_submit` | When user input is received | Input validation, sanitization |
| `notification` | When the agent emits a notification | Routing alerts, UI updates |
| `permission_request` | When a permission check occurs | Custom authorization logic |
| `pre_compact` | Before context compaction | Save critical state before context is trimmed |

### 5.2 Programmatic Hook Format

Hooks are defined as dictionaries with a `matcher` (to filter which tool/event they
apply to) and `hooks` (a list of callback functions):

```python
from datetime import datetime, timezone


async def audit_callback(event):
    await audit_log.write({
        "tool": event.tool_name,
        "input": event.input,
        "output": event.output,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


audit_hook = {
    "event": "post_tool_use",
    "matcher": "*",  # match all tools; or use a specific tool name / glob
    "hooks": [audit_callback],
}


async def validate_sql(event):
    sql = event.input["query"].upper()
    if any(kw in sql for kw in ("DROP", "DELETE", "TRUNCATE")):
        return {"blocked": True, "reason": "Destructive SQL operations are not allowed"}


sql_validator = {
    "event": "pre_tool_use",
    "matcher": "mcp__database__run_query",
    "hooks": [validate_sql],
}
```

### 5.3 Hook Best Practices

- Use `matcher` to scope hooks narrowly. A `pre_tool_use` hook on `"*"` runs before
  every single tool call, which adds latency.
- Keep hook callbacks fast. Slow hooks block the agent's execution loop.
- Use `pre_tool_use` for validation/blocking and `post_tool_use` for logging/side effects.
- Return `{"blocked": True, "reason": "..."}` from `pre_tool_use` to prevent a tool call.

---

## 6. Permissions

Permissions control which tools an agent can use and under what conditions.

### 6.1 Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Standard -- allows most tools, prompts for sensitive ones |
| `strict` | Restrictive -- only explicitly allowed tools can be used |
| `permissive` | Open -- all tools allowed without prompting |
| `plan` | Plan mode -- agent must propose a plan before executing |

### 6.2 Configuring Permissions

```python
permissions = {
    "mode": "strict",
    "allowed_tools": [
        "mcp__search__*",         # all tools from the search MCP server
        "Read",                    # built-in read tool
        "mcp__db__read_query",     # specific DB tool
    ],
    "disallowed_tools": [
        "Bash",                    # no shell access
        "mcp__db__write_query",    # no write access to DB
    ],
}
```

### 6.3 Evaluation Order

When the SDK evaluates whether a tool call is permitted:

1. Check `disallowed_tools` first -- if matched, the call is blocked.
2. Check `allowed_tools` -- if the list is non-empty and the tool is not in it, the
   call is blocked.
3. Apply the permission `mode` for anything not explicitly listed.

This means `disallowed_tools` always wins over `allowed_tools`.

### 6.4 Permission Best Practices

- Start with `strict` mode and explicitly allow only what the agent needs.
- Use glob patterns (`mcp__server__*`) to allow all tools from a trusted MCP server.
- Use `disallowed_tools` as a safety net even in `permissive` mode to block
  dangerous operations.
- For agents that handle user data, default to read-only tool access and require
  explicit opt-in for write operations.

---

## 7. Structured Outputs

Force the agent to return responses conforming to a JSON Schema. Useful for
programmatic consumption of agent output.

### 7.1 Defining Output Format

```python
response = await agent.query(
    prompt="Analyze this customer feedback",
    output_format={
        "type": "json_schema",
        "schema": {
            "type": "object",
            "properties": {
                "sentiment": {
                    "type": "string",
                    "enum": ["positive", "negative", "neutral"],
                    "description": "Overall sentiment of the feedback",
                },
                "topics": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Key topics mentioned",
                },
                "action_items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string"},
                            "priority": {
                                "type": "string",
                                "enum": ["high", "medium", "low"],
                            },
                        },
                        "required": ["description", "priority"],
                    },
                },
                "summary": {
                    "type": "string",
                    "description": "One-paragraph summary",
                },
            },
            "required": ["sentiment", "topics", "action_items", "summary"],
        },
    },
)
```

### 7.2 Using Pydantic Models (Recommended)

The Python SDK integrates naturally with Pydantic for schema definition and
validation:

```python
from pydantic import BaseModel


class ActionItem(BaseModel):
    description: str
    priority: str  # "high", "medium", or "low"


class FeedbackAnalysis(BaseModel):
    sentiment: str  # "positive", "negative", or "neutral"
    topics: list[str]
    action_items: list[ActionItem]
    summary: str


response = await agent.query(
    prompt="Analyze this customer feedback",
    output_format={
        "type": "json_schema",
        "schema": FeedbackAnalysis.model_json_schema(),
    },
)

# Parse the response into a typed object
analysis = FeedbackAnalysis.model_validate_json(response.text)
print(analysis.sentiment)
print(analysis.action_items[0].priority)
```

### 7.3 When to Use Structured Outputs

- The agent's response feeds into downstream code (API responses, database writes).
- You need consistent, parseable output across many invocations.
- You want to enforce a specific schema for classification, extraction, or analysis.

### 7.4 When NOT to Use Structured Outputs

- The agent is having a free-form conversation with a user.
- The response format varies based on the input (use tool returns instead).
- You want the agent to explain its reasoning in natural language.

---

## 8. Skills

Skills are on-demand knowledge modules. Unlike tools (always available to the agent)
or system prompts (always in context), skills are loaded into the agent's context
only when needed. This keeps the context window lean.

### 8.1 What Skills Are Good For

- Domain expertise (coding standards, API references, regulatory knowledge)
- Step-by-step procedures and runbooks
- Troubleshooting guides
- Style guides and writing standards

### 8.2 Skill File Format

Skills are defined as markdown files at `.claude/skills/{name}/SKILL.md` with YAML
frontmatter:

```markdown
---
name: my-skill
description: What this skill provides and when to use it
---

# My Skill

Instructions, reference material, procedures, etc.
```

### 8.3 Enabling Skills in Code

Skills require two things in your SDK configuration:

1. `setting_sources=["project"]` -- tells the SDK to look for project-level settings
   (which is where skills are registered).
2. `"Skill"` in `allowed_tools` -- the agent needs permission to invoke the Skill tool.

```python
response = await agent.query(
    prompt="Follow our coding standards to review this PR",
    setting_sources=["project"],
    allowed_tools=["Skill", "Read", "Edit", "Bash"],
)
```

### 8.4 Skill vs. System Prompt vs. Tool

| Mechanism | In Context | Invoked By | Best For |
|-----------|------------|------------|----------|
| System prompt | Always | Automatic | Core identity, always-on rules |
| Skill | On demand | Agent decides | Domain knowledge, procedures |
| Tool | Always available | Agent decides | Actions, data retrieval |

---

## 9. Slash Commands

Slash commands are user-facing shortcuts that trigger specific agent behaviors.

### 9.1 File-Based Definition

Slash commands are defined as markdown files in `.claude/commands/`:

```
.claude/commands/
  review.md
  deploy.md
  summarize.md
```

Each file has YAML frontmatter:

```markdown
---
description: Review the current PR for issues
allowed-tools:
  - Read
  - Bash
  - Edit
argument-hint: "[file or PR number]"
---

Review the code changes. Focus on:
1. Logic errors and edge cases
2. Security vulnerabilities
3. Performance concerns
4. Adherence to project coding standards

If an argument is provided, focus on that specific file or PR.
```

### 9.2 How They Work

- The user types `/review` in the chat interface.
- The SDK loads `review.md`, injects its content as part of the prompt, and
  restricts the agent to the `allowed-tools` listed in frontmatter.
- The `argument-hint` tells the UI what to show as placeholder text.

---

## 10. User Input and Human-in-the-Loop

The `can_use_tool` callback lets you intercept tool calls and require human approval
before they execute. This is the primary mechanism for human-in-the-loop patterns.

### 10.1 Basic Approval Flow

```python
async def approval_gate(tool_name: str, tool_input: dict) -> bool:
    if tool_name == "mcp__payments__issue_refund":
        amount = tool_input["amount"]
        if amount > 100:
            # Ask the human for approval
            approved = await ask_human_for_approval(
                f"Refund of ${amount} for order {tool_input['order_id']}. Approve?"
            )
            return approved
    return True  # allow all other tool calls


response = await agent.query(
    prompt="Process these refund requests",
    can_use_tool=approval_gate,
)
```

### 10.2 Patterns for Human-in-the-Loop

- **Threshold-based**: Auto-approve below a threshold, escalate above it.
- **Category-based**: Auto-approve reads, require approval for writes/deletes.
- **Confidence-based**: Use a classifier to assess risk and escalate uncertain cases.
- **Always-approve**: Require human sign-off for every action (high-security).

---

## 11. Sandbox and Security

Sandboxing controls what the agent can access on the filesystem and network.

### 11.1 Filesystem Modes

| Mode | Access |
|------|--------|
| `none` | No filesystem access |
| `readonly` | Can read but not write |
| `restricted` | Can only access specified paths |
| `full` | Unrestricted filesystem access |

### 11.2 Network Modes

| Mode | Access |
|------|--------|
| `none` | No network access |
| `localhost` | Only local connections |
| `allowlist` | Only specified domains/IPs |
| `full` | Unrestricted network access |

### 11.3 Sandbox Configuration

```python
sandbox = {
    "filesystem_mode": "restricted",
    "allowed_paths": ["/app/data", "/tmp"],
    "network_mode": "allowlist",
    "network_allowlist": ["api.example.com", "db.internal:5432"],
    "allow_shell": False,
}
```

### 11.4 When to Use Sandboxing

- The agent reads or writes files (restrict to specific directories).
- The agent makes network/API calls (restrict to known hosts).
- The agent can execute code or shell commands (disable shell or restrict heavily).
- You are running untrusted or user-provided prompts.

---

## 12. Common Architecture Patterns

### 12.1 Single Agent with Tools

The simplest pattern. One agent with a set of tools. Good for focused tasks.

```
trigger -> agent -> [tool1, tool2, tool3]
```

**When to use**: The task is well-defined and a single agent can handle it with the
right tools.

### 12.2 Orchestrator-Workers

A coordinator agent delegates to specialized subagents.

```
trigger -> coordinator -> [researcher, coder, reviewer]
                             |            |          |
                          [search]    [bash,edit]  [read]
```

**When to use**: The task has clearly separable subtasks that benefit from different
tools, models, or instructions.

### 12.3 Pipeline / Sequential

Agents in a chain, each processing and passing results forward.

```
trigger -> ingester -> analyzer -> reporter
```

**When to use**: Data flows through well-defined transformation stages.

```python
# Pipeline pattern in Python
ingestion_result = await ingester.query(prompt=f"Ingest: {raw_data}")
analysis_result = await analyzer.query(prompt=f"Analyze: {ingestion_result.text}")
report_result = await reporter.query(prompt=f"Report: {analysis_result.text}")
```

### 12.4 Human-in-the-Loop

Agent proposes actions, humans approve critical ones.

```
trigger -> agent -> [tools]
              |
         can_use_tool -> human approval
```

**When to use**: The agent handles sensitive operations (payments, deletions,
external communications) that need oversight.

### 12.5 Handoff / Escalation

Agent handles what it can, hands off edge cases to humans or other systems.

```
trigger -> triage-agent -> [handle directly]
                       |-> [handoff to specialist agent]
                       |-> [escalate to human]
```

**When to use**: Not all inputs can be handled by a single agent. Some need
specialization or human judgment.

---

## 13. Best Practices

### 13.1 Agent Design

- **Start simple.** One agent, a few tools. Add complexity only when you hit limits.
- **Write clear instructions.** The system prompt is the most important configuration.
  Be specific about what the agent should and should not do.
- **Choose the right model.** Use Haiku for fast, simple subagents. Sonnet for
  general-purpose work. Opus for tasks requiring deep reasoning.
- **Limit tool access.** Only give the agent tools it actually needs. Fewer tools
  means fewer ways things can go wrong and less confusion for the model.

### 13.2 Tool Design

- **Descriptive names and descriptions.** Claude decides which tool to call based on
  the name and description. Make them unambiguous.
- **Small, focused tools.** Each tool should do one thing well. Prefer
  `search_products` and `get_product_details` over a single `product_operation` tool
  with a mode parameter.
- **Return structured data.** JSON responses are easier for Claude to parse and act on
  than free-form text.
- **Handle errors gracefully.** Return informative error messages so Claude can recover
  or report the issue.
- **Prefer `create_sdk_mcp_server()`** for tools that are part of your application code.
  Use external MCP servers for third-party integrations.

### 13.3 Security

- **Default to strict permissions.** Explicitly allow what the agent needs rather than
  blocking what it should not use.
- **Sandbox filesystem and network access.** Especially for agents that run code or
  handle untrusted input.
- **Use hooks for validation.** `pre_tool_use` hooks can block dangerous operations
  before they execute.
- **Implement human-in-the-loop** for irreversible or high-impact actions.
- **Protect secrets.** Pass API keys and credentials through environment variables,
  not through prompts or tool parameters. Use `os.environ` or a secrets manager.

### 13.4 Subagent Design

- **Give each subagent a clear, narrow scope.** A subagent named "researcher" with
  instructions about research and only search tools is better than a generic
  "helper" with all tools.
- **Choose models deliberately.** Not every subagent needs the most capable model.
- **Limit subagent depth.** Subagents spawning their own subagents creates
  coordination overhead and makes debugging hard. One level of delegation is
  usually enough.
- **Use `inherit_tools=False` by default.** Explicitly list each subagent's tools.

### 13.5 Error Handling and Reliability

- **Set `max_turns`** to prevent runaway loops.
- **Use `post_tool_use_failure` hooks** to catch and handle tool errors.
- **Log everything.** Hook into `post_tool_use` and `stop` events for observability.
  Python's `logging` module or `structlog` work well here.
- **Test with representative prompts.** Agent behavior can vary with input phrasing.
  Test edge cases and adversarial inputs.
- **Use `try`/`except` around `agent.query()`** to handle SDK-level errors
  (network failures, rate limits, invalid configurations).

### 13.6 Performance

- **Minimize MCP servers.** Each external MCP server is an additional process or
  network connection. Consolidate where possible.
- **Use `create_sdk_mcp_server()`** for in-process tools to avoid IPC overhead.
- **Scope hooks with matchers.** A `pre_tool_use` hook on `"*"` runs before every tool
  call. Use specific matchers to reduce unnecessary work.
- **Stream responses** for interactive applications to reduce perceived latency.
- **Use `asyncio.gather()`** when running multiple independent agent queries in
  parallel.

---

## 14. Project Structure

A typical Agent SDK Python project:

```
my-agent/
  .claude/
    commands/          # Slash commands (*.md)
      review.md
      deploy.md
    skills/            # Skills (SKILL.md in subdirectories)
      coding-standards/
        SKILL.md
    settings.json      # Project settings (permissions, etc.)
  src/
    __init__.py
    main.py            # Main agent setup and query execution
    tools.py           # Custom tool definitions (create_sdk_mcp_server)
    hooks.py           # Hook definitions
    subagents.py       # Subagent definitions
  pyproject.toml
  requirements.txt
```

### 14.1 Minimal `main.py`

```python
import asyncio
from claude_agent_sdk import Agent
from tools import my_tools
from hooks import audit_hook, sql_validator


async def main():
    agent = Agent(model="claude-sonnet-4-5-20250929")

    response = await agent.query(
        prompt="Find laptops under $500 and summarize the top 3 options",
        system_prompt="You are a helpful shopping assistant.",
        mcp_servers=[my_tools],
        hooks=[audit_hook, sql_validator],
        max_turns=10,
    )

    print(response.text)


if __name__ == "__main__":
    asyncio.run(main())
```

---

## 15. Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| Agent does not use a tool | Tool description is unclear, or tool is not in `allowed_tools` | Improve the tool description; check `allowed_tools` config |
| Agent uses the wrong tool | Tool names or descriptions are ambiguous | Make tool names and descriptions more distinct |
| Agent loops or runs forever | No `max_turns` set, or the task is genuinely hard | Set `max_turns`; improve instructions to guide the agent toward completion |
| Tool call is blocked | Permission rules, hook returning `{"blocked": True}`, or `disallowed_tools` | Check permissions, hooks, and `disallowed_tools` in order |
| Skill is not loaded | Missing `setting_sources=["project"]` or `"Skill"` not in `allowed_tools` | Add both to the query configuration |
| MCP server tools not available | Server failed to start, or wrong transport config | Check server logs; verify `command`/`url`/`env` config |
| Subagent not invoked | Coordinator instructions do not mention delegation, or subagent description is unclear | Make the coordinator's instructions explicit about when to delegate |
| Structured output is invalid | Schema is wrong, or the agent's response does not match | Validate the JSON Schema; simplify complex schemas; use Pydantic models |
| `RuntimeError: no running event loop` | Calling async SDK from synchronous code | Wrap in `asyncio.run()` or use an async entry point |
| `ImportError` | Package not installed or wrong import path | Run `pip install claude-agent-sdk`; check import names |
