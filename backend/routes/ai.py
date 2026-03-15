"""
ai.py — AI assistant for PDF editing
Rule: Only suggest replacements for existing lines, never add new lines.
"""
import os, json
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import urllib.request, urllib.error

router = APIRouter()

SYSTEM_PROMPT = """You are an AI resume improvement assistant.

STRICT RULE — READ CAREFULLY:
PDFs have fixed layout. You can ONLY suggest replacing existing text with improved text.
- NEVER add new lines (would overlap existing content)
- NEVER delete lines (would leave gaps)  
- Keep replacement roughly the same length as original (+/- 30%)
- Only replace when you have a genuinely better suggestion

When given resume text blocks, suggest improvements for:
- Stronger action verbs (e.g. "Managed" → "Led and optimized")
- Better phrasing and clarity
- Grammar and spelling fixes
- More impactful language

Return ONLY a valid JSON array like this (no other text, no markdown):
[
  {
    "blockId": "p1_l5",
    "original": "Managed accounts",
    "suggested": "Led and streamlined accounting operations",
    "reason": "Stronger action verb + more descriptive"
  }
]

If no improvements found, return empty array: []"""

class AIRequest(BaseModel):
    blocks: list
    prompt: str
    sessionId: str

@router.post("/suggest")
async def ai_suggest(req: AIRequest):
    # Build context - only include non-empty text blocks
    context = []
    for b in req.blocks[:60]:
        text = b.get("text","").strip()
        if text and len(text) > 3:
            context.append({
                "id":   b.get("id",""),
                "text": text,
                "bold": b.get("bold", False),
            })

    if not context:
        return JSONResponse({"suggestions": [], "count": 0})

    user_msg = f"""Resume text blocks:
{json.dumps(context, indent=2)}

User request: {req.prompt}

Remember: ONLY suggest replacements for existing lines. Return JSON array only."""

    try:
        payload = json.dumps({
            "model":      "claude-sonnet-4-20250514",
            "max_tokens": 2000,
            "system":     SYSTEM_PROMPT,
            "messages":   [{"role": "user", "content": user_msg}]
        }).encode("utf-8")

        req_obj = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=payload,
            headers={
                "Content-Type":      "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key":         os.environ.get("ANTHROPIC_API_KEY", ""),
            },
            method="POST"
        )

        with urllib.request.urlopen(req_obj, timeout=30) as resp:
            data = json.loads(resp.read().decode())

        raw = data["content"][0]["text"].strip()

        # Clean up markdown fences if present
        if "```" in raw:
            parts = raw.split("```")
            for part in parts:
                part = part.strip()
                if part.startswith("json"): part = part[4:].strip()
                if part.startswith("["): raw = part; break

        raw = raw.strip()
        if not raw.startswith("["): raw = "[]"

        suggestions = json.loads(raw)
        if not isinstance(suggestions, list): suggestions = []

        # Validate each suggestion has required fields
        valid = []
        for s in suggestions:
            if all(k in s for k in ["blockId","original","suggested","reason"]):
                if s["suggested"].strip() and s["suggested"] != s["original"]:
                    valid.append(s)

        return JSONResponse({"suggestions": valid, "count": len(valid)})

    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return JSONResponse({"suggestions": [], "count": 0, "error": f"API error {e.code}: {body[:200]}"})
    except Exception as e:
        return JSONResponse({"suggestions": [], "count": 0, "error": str(e)})
