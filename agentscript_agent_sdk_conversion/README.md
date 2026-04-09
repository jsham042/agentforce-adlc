# agentscript-to-sdk

A very small transpiler from a subset of Salesforce **Agent Script** to a
**Claude Agent SDK** agent definition in Python.

It maps the Agentforce concepts onto Agent SDK primitives:

| Agent Script              | Claude Agent SDK                                   |
| ------------------------- | -------------------------------------------------- |
| `agent:` / `instruction`  | `SYSTEM_PROMPT` passed to `ClaudeAgentOptions`     |
| `variables:`              | module-level `vars: dict` conversation state       |
| `actions:`                | `@tool` stubs bundled via `create_sdk_mcp_server`  |
| `reasoning:` block        | deterministic `async def topic_<name>()` function  |
| `run @actions.X(...)`     | `outputs["X"] = await X(...)`                      |
| `respond "..."`           | `return "..."`                                     |

## Install

```bash
pip install pyyaml claude-agent-sdk
```

## Usage

```bash
python agentscript_to_sdk.py examples/order_support.ascript out.py
```

`out.py` is a runnable Claude Agent SDK agent. Fill in the `@tool` stubs
(the former Agentforce Actions) and run:

```bash
ANTHROPIC_API_KEY=... python out.py "I want a refund on order 123"
```

## Supported subset

`agent`, `variables`, `actions`, `topics` with `description` / `instruction`
/ `reasoning`. Reasoning supports `if` / `elif` / `else` / `end`, `run`,
`set`, `respond`, `instruction`, and `@vars.*` / `@outputs.*` / `@actions.*`
references. Nested `if` blocks need explicit `end` markers.

## Not supported (yet)

Type checking of references, Flow/Apex action bindings, multi-topic routing,
wiring `extra_instructions` back into the LLM call.
