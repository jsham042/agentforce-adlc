"""Auto-generated from Agent Script. Do not edit by hand."""
from __future__ import annotations
import anyio
from claude_agent_sdk import query, tool, ClaudeAgentOptions, create_sdk_mcp_server

# Conversation-scoped variables (Agent Script `variables:` block)
vars: dict = {"order_id": None, "refund_eligible": None}
outputs: dict = {}

@tool("LookupOrder", "Fetch an order record by id.", {'order_id': {'type': 'text'}})
async def LookupOrder(order_id: str):
    """TODO: implement (was Agentforce action `LookupOrder`)."""
    raise NotImplementedError

@tool("InitiateRefund", "Start a refund for an order.", {'order_id': {'type': 'text'}})
async def InitiateRefund(order_id: str):
    """TODO: implement (was Agentforce action `InitiateRefund`)."""
    raise NotImplementedError

async def topic_Refunds() -> str | None:
    """Handle refund requests."""
    extra_instructions: list[str] = []
    outputs["LookupOrder"] = await LookupOrder(order_id=vars["order_id"])
    if outputs["LookupOrder"]["status"] == "Delivered" and outputs["LookupOrder"]["days_since_delivery"] <= 30:
        vars["refund_eligible"] = True
        outputs["InitiateRefund"] = await InitiateRefund(order_id=vars["order_id"])
        return "Your refund has been started. You'll see it in 3-5 business days."
    else:
        vars["refund_eligible"] = False
        extra_instructions.append("Explain the 30-day return window and offer alternatives.")
    return None

SYSTEM_PROMPT = 'Helps customers with order status and refunds.\n\n## Topic: Refunds\nBe empathetic. Confirm the order, explain the policy clearly, and never promise a refund before eligibility is checked.\n'

TOPIC_HANDLERS = {"Refunds": topic_Refunds}

async def main(user_message: str) -> None:
    server = create_sdk_mcp_server(
        name="OrderSupportAgent_actions",
        tools=[LookupOrder, InitiateRefund],
    )
    options = ClaudeAgentOptions(
        system_prompt=SYSTEM_PROMPT,
        mcp_servers={"actions": server},
    )
    async for msg in query(prompt=user_message, options=options):
        print(msg)

if __name__ == "__main__":
    import sys as _sys
    anyio.run(main, _sys.argv[1] if len(_sys.argv) > 1 else "hello")
