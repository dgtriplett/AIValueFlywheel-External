"""Foundation Model API client (OpenAI-compatible).

CHUNK A ships the client factory only; the AI agents are wired in later chunks.
"""
from .config import get_oauth_token, get_workspace_host, SERVING_ENDPOINT


def get_llm_client():
    """Return an AsyncOpenAI client pointed at Databricks serving endpoints."""
    from openai import AsyncOpenAI

    host = get_workspace_host()
    token = get_oauth_token()
    return AsyncOpenAI(api_key=token, base_url=f"{host}/serving-endpoints")


async def chat_completion(messages: list, model: str = SERVING_ENDPOINT,
                          max_tokens: int = 4096) -> str:
    """Call the Foundation Model and return the reply text.

    NOTE: no `temperature` is sent. The deployed reasoning models (claude-sonnet-5+)
    REJECT the temperature parameter with a hard 400 ("does not support the temperature
    parameter"), which silently made every caller of this simple path fall back to a
    heuristic. Reasoning models are effectively low-temperature anyway.

    The reply `content` may come back as a plain string OR a list of typed content
    blocks (reasoning models); both are flattened to text so callers get a string.
    """
    client = get_llm_client()
    resp = await client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
    )
    content = resp.choices[0].message.content
    if isinstance(content, list):
        content = "".join(
            b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
    return content or ""
