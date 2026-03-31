import tempfile, shutil, hashlib, time, re, json, os
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
import fitz

router = APIRouter()

# ── Session persistence ───────────────────────────────────────
# Store sessions on disk so they survive Render free-tier restarts.
# Each session lives at /tmp/pdfforge_sessions/<sid>/
#   session.json  → metadata (filename, pageCount, pages/blocks)
#   original.pdf  → the uploaded PDF

SESSIONS_DIR = Path(tempfile.gettempdir()) / "pdfforge_sessions"
SESSIONS_DIR.mkdir(exist_ok=True)

def _session_dir(sid: str) -> Path:
    return SESSIONS_DIR / sid

def _save_session(sid: str, meta: dict):
    d = _session_dir(sid)
    d.mkdir(exist_ok=True)
    with open(d / "session.json", "w") as f:
        json.dump(meta, f)

def _load_session(sid: str) -> dict | None:
    meta_file = _session_dir(sid) / "session.json"
    if not meta_file.exists():
        return None
    with open(meta_file) as f:
        return json.load(f)


def clean(text):
    fixes = {'\uf0b7':'•','\uf0a7':'•','\u2022':'•','\u00a0':' ','\uf020':' '}
    for b,g in fixes.items(): text = text.replace(b,g)
    return re.sub(r'  +', ' ', text).strip()

def extract_blocks(pdf_path):
    """
    Extract text blocks by grouping all spans on the same LINE into one card.
    Uses 'dict' method (most reliable across all PyMuPDF versions).
    """
    doc   = fitz.open(pdf_path)
    pages = []

    for pn, page in enumerate(doc, 1):
        pw, ph   = page.rect.width, page.rect.height
        raw_lines = []

        page_dict = page.get_text("dict")

        for block in page_dict.get("blocks", []):
            if block.get("type") != 0:
                continue

            for line in block.get("lines", []):
                spans = line.get("spans", [])
                if not spans:
                    continue

                merged_text  = ""
                sizes        = []
                bold_count   = 0
                italic_count = 0
                fonts        = []

                for span in spans:
                    raw  = span.get("text", "")
                    if not raw:
                        continue
                    merged_text  += raw
                    size  = span.get("size", 11.0)
                    font  = span.get("font", "")
                    flags = span.get("flags", 0)
                    sizes.append(size)
                    fonts.append(font)
                    if bool(flags & 16) or "Bold" in font:
                        bold_count += 1
                    if bool(flags & 2) or "Italic" in font:
                        italic_count += 1

                text = clean(merged_text)
                if not text:
                    continue

                n        = len(spans)
                avg_size = round(sum(sizes) / len(sizes), 2) if sizes else 11.0
                dom_font = max(set(fonts), key=fonts.count) if fonts else ""
                bold     = bold_count   > n / 2
                italic   = italic_count > n / 2

                bbox = line.get("bbox", [0, 0, 0, 0])
                x0, y0, x1, y1 = float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])

                if x1 <= x0 or y1 <= y0:
                    continue

                raw_lines.append({
                    "text":      text,
                    "bold":      bold,
                    "italic":    italic,
                    "size":      avg_size,
                    "font":      dom_font,
                    "x0":        round(x0, 2),
                    "y0":        round(y0, 2),
                    "x1":        round(x1, 2),
                    "y1":        round(y1, 2),
                    "maxWidth":  round(pw - x0 - 36, 2),
                    "pageWidth": round(pw, 2),
                })

        raw_lines.sort(key=lambda l: (round(l["y0"], 0), l["x0"]))

        blocks = []
        for bid, ln in enumerate(raw_lines):
            blocks.append({
                "id":        f"p{pn}_l{bid}",
                "text":      ln["text"],
                "original":  ln["text"],
                "page":      pn,
                "x0":        ln["x0"],
                "y0":        ln["y0"],
                "x1":        ln["x1"],
                "y1":        ln["y1"],
                "width":     round(ln["x1"] - ln["x0"], 2),
                "height":    round(ln["y1"] - ln["y0"], 2),
                "fontSize":  ln["size"],
                "font":      ln["font"],
                "bold":      ln["bold"],
                "italic":    ln["italic"],
                "maxWidth":  ln["maxWidth"],
                "pageWidth": ln["pageWidth"],
                "color":     "rgb(0,0,0)",
                "changed":   False,
            })

        pages.append({
            "page":   pn,
            "width":  pw,
            "height": ph,
            "blocks": blocks,
        })

    doc.close()
    total = sum(len(p["blocks"]) for p in pages)
    print(f"Extracted {total} line blocks from {len(pages)} pages")
    return {"pageCount": len(pages), "pages": pages}


@router.post("")
async def upload(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files accepted.")

    sid      = hashlib.md5(f"{file.filename}{time.time()}".encode()).hexdigest()[:12]
    sess_dir = _session_dir(sid)
    sess_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = str(sess_dir / "original.pdf")

    with open(pdf_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        data = extract_blocks(pdf_path)
    except Exception as e:
        shutil.rmtree(str(sess_dir), ignore_errors=True)
        raise HTTPException(422, f"Failed to read PDF: {e}")

    _save_session(sid, {
        "pdf":      pdf_path,
        "tmp_dir":  str(sess_dir),
        "filename": file.filename,
    })

    return {"sessionId": sid, "filename": file.filename, **data}


@router.get("/pdf/{sid}")
def serve_pdf(sid: str):
    meta = _load_session(sid)
    if not meta:
        raise HTTPException(404, "Session not found.")
    return FileResponse(meta["pdf"], media_type="application/pdf")


def get_session(sid: str) -> dict:
    meta = _load_session(sid)
    if not meta:
        raise HTTPException(404, "Session expired. Please re-upload.")
    return meta
