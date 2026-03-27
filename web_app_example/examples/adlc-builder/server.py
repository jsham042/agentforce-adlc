"""FastAPI entry point for the ADLC Builder agent."""

from pathlib import Path

from harness import create_app

from agent import create_agent

STARTER_PROMPTS = [
    {
        "title": "Build a new agent",
        "prompt": (
            "Build an Agentforce agent for order status lookups. It should "
            "greet the customer, ask for an order number, look it up, and "
            "summarise the status and expected delivery date."
        ),
    },
    {
        "title": "Check what exists in my org",
        "prompt": (
            "I've got an .agent file at force-app/main/default/aiAuthoringBundles/. "
            "Check which of its flow:// and apex:// targets already exist in my org "
            "and which I still need to scaffold."
        ),
    },
    {
        "title": "Scaffold missing metadata",
        "prompt": (
            "Generate Flow XML and Apex stubs for the missing targets in my "
            "agent, then give me a deployment plan."
        ),
    },
    {
        "title": "Test and optimise",
        "prompt": (
            "Run a smoke test against my deployed agent, pull the session "
            "traces, and tell me where the topic routing is going wrong."
        ),
    },
    {
        "title": "Safety review",
        "prompt": (
            "Review my .agent file for safety and responsible-AI concerns "
            "before I ship it to production."
        ),
    },
]

app = create_app(
    create_agent,
    {
        "agent_name": "ADLC Builder",
        "sessions_dir": Path(__file__).parent / "sessions",
        "starter_prompts": STARTER_PROMPTS,
        # "permissive" = tell the agent where its artifacts dir is (so files
        # surface in the UI panel) but don't restrict writes — ADLC needs to
        # edit the repo's force-app/ tree for the discover/scaffold/deploy loop.
        "sandbox": "permissive",
    },
)
