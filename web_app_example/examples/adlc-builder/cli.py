"""CLI entry point for the ADLC Builder agent."""

from harness import run_cli

from agent import create_agent

if __name__ == "__main__":
    run_cli(
        create_agent,
        agent_name="ADLC Builder",
        description="Conversational front end for the Agentforce ADLC toolchain.",
    )
