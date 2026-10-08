"""
ai.py — AI routes for PDFForge
  POST /api/ai/suggest  — resume text improvement (existing)
  POST /api/ai/chat     — document Q&A chat (NEW)
  POST /api/ai/ats      — ATS keyword analysis (NEW)
"""
import os, json
import urllib.request, urllib.error
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter()

ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL         = "claude-sonnet-4-20250514"

# ─── Helpers ──────────────────────────────────────────────────────────────────

def claude_call(system: str, user: str, max_tokens: int = 1500) -> str:
    payload = json.dumps({
        "model":      MODEL,
        "max_tokens": max_tokens,
        "system":     system,
        "messages":   [{"role": "user", "content": user}],
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data    = payload,
        headers = {
            "Content-Type":      "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key":         ANTHROPIC_KEY,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        return data["content"][0]["text"].strip()
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise HTTPException(502, f"Claude API error {e.code}: {body[:300]}")
    except Exception as e:
        raise HTTPException(502, str(e))


def strip_json_fences(raw: str) -> str:
    if "```" in raw:
        for part in raw.split("```"):
            part = part.strip()
            if part.startswith("json"): part = part[4:].strip()
            if part.startswith("{") or part.startswith("["):
                return part
    return raw.strip()


# ─── 1. Resume Suggest (existing, improved) ──────────────────────────────────

SUGGEST_SYSTEM = """You are an AI resume improvement assistant.

STRICT RULE: PDFs have fixed layout. You can ONLY suggest replacing existing text.
- NEVER add new lines
- NEVER delete lines
- Keep replacement roughly the same length (+/- 30%)
- Only replace when you have a genuinely better suggestion

Improve: action verbs, clarity, grammar, impact.

Return ONLY a valid JSON array (no markdown):
[{"blockId":"p1_l5","original":"...","suggested":"...","reason":"..."}]

If no improvements found, return: []"""

class SuggestRequest(BaseModel):
    blocks:    list
    prompt:    str
    sessionId: str

@router.post("/suggest")
async def ai_suggest(req: SuggestRequest):
    context = [
        {"id": b.get("id",""), "text": b.get("text","").strip(), "bold": b.get("bold", False)}
        for b in req.blocks[:60]
        if b.get("text","").strip() and len(b.get("text","")) > 3
    ]
    if not context:
        return JSONResponse({"suggestions": [], "count": 0})

    user_msg = f"""Resume text blocks:
{json.dumps(context, indent=2)}

User request: {req.prompt}

Return JSON array only."""

    try:
        raw         = claude_call(SUGGEST_SYSTEM, user_msg, max_tokens=2000)
        raw         = strip_json_fences(raw)
        if not raw.startswith("["): raw = "[]"
        suggestions = json.loads(raw)
        if not isinstance(suggestions, list): suggestions = []
        valid = [
            s for s in suggestions
            if all(k in s for k in ["blockId","original","suggested","reason"])
            and s["suggested"].strip() and s["suggested"] != s["original"]
        ]
        return JSONResponse({"suggestions": valid, "count": len(valid)})
    except HTTPException: raise
    except Exception as e:
        return JSONResponse({"suggestions": [], "count": 0, "error": str(e)})


# ─── 2. Document Chat (NEW) ───────────────────────────────────────────────────

CHAT_SYSTEM = """You are a helpful document assistant. The user has uploaded a PDF and wants to ask questions about it.

- Answer concisely and accurately based on the document content
- If the answer isn't in the document, say so clearly
- For financial documents, extract specific numbers and dates
- For resumes, give actionable improvement advice
- Keep responses under 250 words unless detail is needed
- Use bullet points for lists
- Be friendly and conversational"""

class ChatRequest(BaseModel):
    sessionId: str
    context:   str
    message:   str

@router.post("/chat")
async def ai_chat(req: ChatRequest):
    if not req.context.strip():
        return JSONResponse({"reply": "I couldn't read any text from this document. It may be a scanned PDF — try running OCR first."})

    user_msg = f"""Document content:
---
{req.context[:4000]}
---

User question: {req.message}"""

    try:
        reply = claude_call(CHAT_SYSTEM, user_msg, max_tokens=600)
        return JSONResponse({"reply": reply})
    except HTTPException as e:
        return JSONResponse({"reply": f"AI error: {e.detail}"})
    except Exception as e:
        return JSONResponse({"reply": f"Error: {str(e)}"})


# ─── 3. ATS Keyword Analysis (NEW) ───────────────────────────────────────────

ATS_SYSTEM = """You are an ATS (Applicant Tracking System) expert analyzing a resume.

Given resume text (and optionally a job description), return a JSON object:
{
  "found":   ["keyword1", ...],   // strong ATS keywords in resume (max 8)
  "missing": ["keyword1", ...],   // important missing keywords (max 8)
  "tip":     "One actionable improvement tip"
}

Focus on: technical skills, soft skills, industry terms, tools, certifications.
Return ONLY the JSON object, no markdown."""

class ATSRequest(BaseModel):
    resumeText:     str
    jobDescription: str = ""

@router.post("/ats")
async def ai_ats(req: ATSRequest):
    user_msg = f"""Resume text:
{req.resumeText[:3000]}

{f"Job Description:{chr(10)}{req.jobDescription[:1000]}" if req.jobDescription else ""}

Analyze for ATS keywords."""

    try:
        raw = claude_call(ATS_SYSTEM, user_msg, max_tokens=500)
        raw = strip_json_fences(raw)
        if not raw.startswith("{"): raw = '{"found":[],"missing":[],"tip":""}'
        data = json.loads(raw)
        return JSONResponse({
            "found":   data.get("found", [])[:8],
            "missing": data.get("missing", [])[:8],
            "tip":     data.get("tip", ""),
        })
    except HTTPException: raise
    except Exception as e:
        return JSONResponse({"found": [], "missing": [], "tip": str(e)})
