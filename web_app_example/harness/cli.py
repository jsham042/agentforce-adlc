"""CLI interface for agent applications.

Works with any agent defined as a factory function returning ClaudeAgentOptions.
The harness owns the ClaudeSDKClient lifecycle.

Usage:
    from harness import run_cli
    from my_agent import create_my_agent

    if __name__ == "__main__":
        run_cli(create_my_agent, agent_name="My Agent")
"""

import asyncio
import tempfile
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv

from claude_agent_sdk import ClaudeSDKClient, ResultMessage

from .types import AgentFactory
from .sandbox import apply_sandbox
from .transcript import link_transcript
from .utils.console_logger import print_activity
from .utils.usage_tracker import UsageTracker

load_dotenv()


async def _run_interactive_session(
    agent_factory: AgentFactory,
    agent_name: str,
    sandbox_path: Path,
) -> None:
    """Run an interactive CLI session."""
    print(f"\n=== {agent_name} ===")
    print("Type 'exit' or 'quit' to end.\n")

    options = apply_sandbox(agent_factory(), sandbox_path)
    usage = UsageTracker()
    session_id: str | None = None
    session_dir = sandbox_path.parent

    async with ClaudeSDKClient(options) as client:
        try:
            while True:
                try:
                    user_input = input("\nYou: ").strip()
                except (EOFError, KeyboardInterrupt):
                    break

                if not user_input or user_input.lower() in ["exit", "quit", "q"]:
                    break

                print()
                await client.query(user_input)
                async for msg in client.receive_response():
                    print_activity(msg)
                    if isinstance(msg, ResultMessage):
                        usage.update(msg)
                        if msg.session_id and not session_id:
                            session_id = msg.session_id
                            cwd = options.cwd or Path.cwd()
                            link_transcript(session_id, session_dir, Path(cwd))

                # Show stats after each turn
                stats = usage.to_dict()
                print(f"\n[Turn {stats['turn_count']} | "
                      f"Tokens: {stats['main_agent']['input_tokens']}in/"
                      f"{stats['main_agent']['output_tokens']}out | "
                      f"Cost: ${stats['total_cost_usd']:.4f}]")

        except ValueError as e:
            print(f"\nError: {e}")
            return

        # Final stats
        stats = usage.to_dict()
        print(f"\n--- Session Summary ---")
        if session_id:
            print(f"Session: {session_id}")
        print(f"Turns: {stats['turn_count']}")
        print(f"Tokens: {stats['main_agent']['input_tokens']} in / "
              f"{stats['main_agent']['output_tokens']} out")
        print(f"Cost: ${stats['total_cost_usd']:.4f}")

    print("\nGoodbye!")


def run_cli(
    agent_factory: AgentFactory,
    agent_name: str = "Agent",
    description: str | None = None,
    sandbox_path: Path | None = None,
) -> None:
    """Run an interactive CLI session with the given agent factory.

    Args:
        agent_factory: A function (sandbox_path: Path) -> ClaudeAgentOptions.
        agent_name: Display name for the agent.
        description: Optional description shown in the header.
        sandbox_path: Optional sandbox directory. If not provided, a temp dir is used.
    """
    if description:
        print(f"\n{description}")

    if sandbox_path:
        sandbox_path.mkdir(parents=True, exist_ok=True)
        asyncio.run(_run_interactive_session(agent_factory, agent_name, sandbox_path))
    else:
        with tempfile.TemporaryDirectory() as tmpdir:
            sb = Path(tmpdir) / "sandbox"
            sb.mkdir()
            asyncio.run(_run_interactive_session(agent_factory, agent_name, sb))


def create_cli_runner(
    agent_factory: AgentFactory,
    agent_name: str = "Agent",
    description: str | None = None,
) -> Callable:
    """Create a CLI runner function for the given agent factory."""
    def runner(sandbox_path: Path | None = None) -> None:
        run_cli(agent_factory, agent_name, description, sandbox_path)
    return runner
