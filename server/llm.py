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


def extract_json(text: str):
    """Pull the first JSON object/array out of a model reply (tolerates ```json fences).

    Reasoning models can emit thinking text (with its own braces) before the answer,
    so a naive first-{/last-} slice captures garbage: every top-level {...} object is
    tried in order and the first that parses wins."""
    import json
    import re

    if not text:
        return None
    t = re.sub(r"```(?:json)?", "", text).strip()
    try:
        return json.loads(t)
    except Exception:  # noqa: BLE001
        pass
    depth, start = 0, -1
    for i, ch in enumerate(t):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start != -1:
                try:
                    return json.loads(t[start:i + 1])
                except Exception:  # noqa: BLE001
                    start = -1
    for opener, closer in (("{", "}"), ("[", "]")):
        i, j = t.find(opener), t.rfind(closer)
        if i != -1 and j > i:
            try:
                return json.loads(t[i:j + 1])
            except Exception:  # noqa: BLE001
                continue
    return None
