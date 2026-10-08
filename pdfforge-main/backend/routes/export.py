import os, base64
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from routes.upload import get_session
import fitz, urllib.request

router = APIRouter()

NOTO      = Path(__file__).parent.parent / "services" / "NotoSans-Regular.ttf"
NOTO_BOLD = Path(__file__).parent.parent / "services" / "NotoSans-Bold.ttf"

def ensure_noto():
    for p,u in [(NOTO,"https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans-Regular.ttf"),
                (NOTO_BOLD,"https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans-Bold.ttf")]:
        if not p.exists():
            try: urllib.request.urlretrieve(u, str(p))
            except: pass

def get_font(bold):
    p = NOTO_BOLD if bold else NOTO
    if p.exists(): return "noto", str(p)
    return ("hebo" if bold else "helv"), None

def apply_changes(original_pdf, sections, output_path):
    ensure_noto()
    doc = fitz.open(original_pdf)
    changed = {}
    for b in sections:
        if b.get("changed") and b.get("text") != b.get("original"):
            p = b.get("page", 1)
            changed.setdefault(p, []).append(b)

    for pn, pblocks in changed.items():
        page = doc[pn-1]
        for b in pblocks:
            x0   = float(b["x0"])
            y0   = float(b["y0"])
            x1   = float(b.get("x1", x0 + b.get("width", 200)))
            y1   = float(b["y1"])
            size = float(b["fontSize"])
            bold = bool(b.get("bold", False))
            text = b.get("text","").strip()
            pw   = page.rect.width
            # Cover entire line width to page edge
            page.draw_rect(fitz.Rect(x0-1, y0-1, pw-30, y1+2), color=(1,1,1), fill=(1,1,1))
            if not text: continue
            fn, ff = get_font(bold)
            kw = {"fontsize": size, "color": (0,0,0)}
            if ff: kw["fontfile"]=ff; kw["fontname"]=fn
            else:  kw["fontname"]=fn
            try:    page.insert_text(fitz.Point(x0, y1-1), text, **kw)
            except: page.insert_text(fitz.Point(x0, y1-1), text, fontname="helv", fontsize=size, color=(0,0,0))

    doc.save(output_path, garbage=4, deflate=True)
    doc.close()

class ExportBody(BaseModel):
    blocks: list

@router.post("/{sid}")
def export(sid: str, body: ExportBody):
    s   = get_session(sid)
    out = os.path.join(s["tmp_dir"], f"{Path(s['filename']).stem}_edited.pdf")
    try: apply_changes(s["pdf"], body.blocks, out)
    except Exception as e: raise HTTPException(500, f"Export failed: {e}")
    return FileResponse(out, media_type="application/pdf",
                        filename=f"{Path(s['filename']).stem}_edited.pdf")

@router.get("/{sid}/preview")
def preview(sid: str):
    """Render current state of PDF as images."""
    s   = get_session(sid)
    doc = fitz.open(s["pdf"])
    mat = fitz.Matrix(1.4, 1.4)
    pages_b64 = []
    for page in doc:
        pix = page.get_pixmap(matrix=mat, alpha=False)
        b64 = base64.b64encode(pix.tobytes("png")).decode()
        pages_b64.append(f"data:image/png;base64,{b64}")
    doc.close()
    return JSONResponse({"pages": pages_b64, "count": len(pages_b64)})

@router.post("/{sid}/preview-edited")
def preview_edited(sid: str, body: ExportBody):
    """Apply edits and render as preview images."""
    s   = get_session(sid)
    tmp = os.path.join(s["tmp_dir"], "preview_edit.pdf")
    try: apply_changes(s["pdf"], body.blocks, tmp)
    except Exception as e: raise HTTPException(500, f"Preview failed: {e}")
    doc = fitz.open(tmp)
    mat = fitz.Matrix(1.4, 1.4)
    pages_b64 = []
    for page in doc:
        pix = page.get_pixmap(matrix=mat, alpha=False)
        b64 = base64.b64encode(pix.tobytes("png")).decode()
        pages_b64.append(f"data:image/png;base64,{b64}")
    doc.close()
    return JSONResponse({"pages": pages_b64, "count": len(pages_b64)})
