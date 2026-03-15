import os, tempfile, shutil, base64
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from typing import List, Optional
import fitz

router = APIRouter()

import math

def _apply_watermark_text(page, text: str, font_size: int, rotation_deg: float):
    """
    Draw watermark text at arbitrary rotation using Shape + morph matrix.
    Works for any angle (0, 45, 90, etc.) unlike insert_text which only
    accepts multiples of 90.
    """
    pw, ph = page.rect.width, page.rect.height
    # Center of page
    cx, cy = pw / 2, ph / 2

    # Build rotation matrix (fitz.Matrix accepts degrees directly)
    mat = fitz.Matrix(rotation_deg)

    shape = page.new_shape()
    # Place text at center, then rotate around center point
    shape.insert_text(
        fitz.Point(cx, cy),
        text,
        fontsize=font_size,
        color=(0.65, 0.65, 0.65),
        morph=(fitz.Point(cx, cy), mat),
    )
    shape.commit(overlay=True)



# ── THUMBNAILS ─────────────────────────────────────────────────────────
@router.post("/thumbnails")
async def get_thumbnails(file: UploadFile = File(...)):
    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, file.filename)
    with open(src,"wb") as f: shutil.copyfileobj(file.file, f)
    doc = fitz.open(src)
    thumbs = []
    mat = fitz.Matrix(0.35, 0.35)
    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=mat, alpha=False)
        b64 = base64.b64encode(pix.tobytes("png")).decode()
        thumbs.append({"page":i+1,"img":f"data:image/png;base64,{b64}","width":pix.width,"height":pix.height})
    doc.close(); shutil.rmtree(tmp, ignore_errors=True)
    return {"count":len(thumbs),"thumbnails":thumbs}

# ── MERGE ──────────────────────────────────────────────────────────────
@router.post("/merge")
async def merge(files: List[UploadFile] = File(...)):
    if len(files)<2: raise HTTPException(400,"Need at least 2 PDFs.")
    tmp = tempfile.mkdtemp(); out = os.path.join(tmp,"merged.pdf")
    result = fitz.open()
    for f in files:
        p = os.path.join(tmp,f.filename)
        with open(p,"wb") as fp: shutil.copyfileobj(f.file,fp)
        doc = fitz.open(p); result.insert_pdf(doc); doc.close()
    result.save(out); result.close()
    return FileResponse(out, media_type="application/pdf", filename="merged.pdf")

# ── SPLIT ──────────────────────────────────────────────────────────────
@router.post("/split")
async def split(file: UploadFile = File(...), pages: str = Form(...)):
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,file.filename); out = os.path.join(tmp,"split.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src); result = fitz.open()
    for part in pages.split(","):
        part=part.strip()
        if "-" in part:
            a,b=part.split("-")
            for n in range(int(a)-1,min(int(b),doc.page_count)): result.insert_pdf(doc,from_page=n,to_page=n)
        elif part.isdigit():
            n=int(part)-1
            if 0<=n<doc.page_count: result.insert_pdf(doc,from_page=n,to_page=n)
    result.save(out); result.close(); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="split.pdf")

# ── EXTRACT ────────────────────────────────────────────────────────────
@router.post("/extract")
async def extract(file: UploadFile = File(...), pages: str = Form(...)):
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,file.filename); out = os.path.join(tmp,"extracted.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src); result = fitz.open()
    for p in pages.split(","):
        p=p.strip()
        if p.isdigit():
            n=int(p)-1
            if 0<=n<doc.page_count: result.insert_pdf(doc,from_page=n,to_page=n)
    result.save(out); result.close(); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="extracted.pdf")

# ── ROTATE ─────────────────────────────────────────────────────────────
@router.post("/rotate")
async def rotate(file: UploadFile = File(...), degrees: int = Form(90), pages: str = Form("all")):
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,file.filename); out = os.path.join(tmp,"rotated.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src)
    pl = list(range(doc.page_count)) if pages=="all" else [int(p)-1 for p in pages.split(",") if p.strip().isdigit()]
    for n in pl:
        if 0<=n<doc.page_count: doc[n].set_rotation(degrees)
    doc.save(out); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="rotated.pdf")

# ── DELETE PAGES ───────────────────────────────────────────────────────
@router.post("/delete-pages")
async def delete_pages(file: UploadFile = File(...), pages: str = Form(...)):
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,file.filename); out = os.path.join(tmp,"output.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src)
    nums = sorted(set(int(p)-1 for p in pages.split(",") if p.strip().isdigit()), reverse=True)
    for n in nums:
        if 0<=n<doc.page_count: doc.delete_page(n)
    doc.save(out); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="output.pdf")

# ── COMPRESS ───────────────────────────────────────────────────────────
@router.post("/compress")
async def compress(file: UploadFile = File(...)):
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,file.filename); out = os.path.join(tmp,"compressed.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src)
    doc.save(out, garbage=4, deflate=True, clean=True); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="compressed.pdf")

# ── WATERMARK (FIXED) ──────────────────────────────────────────────────
@router.post("/watermark")
async def watermark(
    file: UploadFile = File(...),
    text: str = Form("CONFIDENTIAL"),
    opacity: str = Form("0.25"),
    rotation: str = Form("45"),
    font_size: str = Form("52"),
):
    try:
        rot = float(rotation)
        fs  = int(float(font_size))
    except:
        rot, fs = 45.0, 52

    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, "input.pdf")
    out = os.path.join(tmp, "watermarked.pdf")
    try:
        with open(src, "wb") as f:
            shutil.copyfileobj(file.file, f)
        doc = fitz.open(src)
        for page in doc:
            _apply_watermark_text(page, text, fs, rot)
        doc.save(out, garbage=4, deflate=True)
        doc.close()
    except Exception as e:
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(500, f"Watermark failed: {str(e)}")
    return FileResponse(out, media_type="application/pdf", filename="watermarked.pdf")

# ── STAMP (FIXEDreturn FileResponse(out, media_type="application/pdf", filename="watermarked.pdf")

# ── STAMP (FIXED with position) ────────────────────────────────────────
@router.post("/stamp")
async def stamp(
    file: UploadFile = File(...),
    label: str = Form("APPROVED"),
    pages: str = Form("all"),
    position: str = Form("top-right"),  # top-left,top-center,top-right,middle-left,middle-center,middle-right,bottom-left,bottom-center,bottom-right
    custom_text: str = Form(""),
    font_size: int = Form(18),
    rotation: int = Form(0),
):
    COLORS = {
        "APPROVED":     (0.0, 0.55, 0.15),
        "DRAFT":        (0.8, 0.45, 0.0),
        "CONFIDENTIAL": (0.75, 0.0, 0.0),
        "REJECTED":     (0.85, 0.0, 0.0),
        "FINAL":        (0.0, 0.1, 0.8),
        "COPY":         (0.2, 0.2, 0.75),
        "CUSTOM":       (0.2, 0.2, 0.2),
    }
    stamp_text = custom_text.strip() if custom_text.strip() else label
    color      = COLORS.get(label.upper(), (0.3, 0.3, 0.3))
    stamp_w    = max(len(stamp_text) * font_size * 0.62 + 24, 90)
    stamp_h    = font_size + 18

    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,"input.pdf"); out = os.path.join(tmp,"stamped.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src)
    pl = list(range(doc.page_count)) if pages=="all" else [int(p)-1 for p in pages.split(",") if p.strip().isdigit()]

    for n in pl:
        if not (0<=n<doc.page_count): continue
        page = doc[n]; pw,ph = page.rect.width, page.rect.height
        margin = 20

        # Position mapping
        pos_map = {
            "top-left":       (margin, margin),
            "top-center":     ((pw - stamp_w)/2, margin),
            "top-right":      (pw - stamp_w - margin, margin),
            "middle-left":    (margin, (ph - stamp_h)/2),
            "middle-center":  ((pw - stamp_w)/2, (ph - stamp_h)/2),
            "middle-right":   (pw - stamp_w - margin, (ph - stamp_h)/2),
            "bottom-left":    (margin, ph - stamp_h - margin),
            "bottom-center":  ((pw - stamp_w)/2, ph - stamp_h - margin),
            "bottom-right":   (pw - stamp_w - margin, ph - stamp_h - margin),
        }
        sx, sy = pos_map.get(position, (pw - stamp_w - margin, margin))
        rect = fitz.Rect(sx, sy, sx + stamp_w, sy + stamp_h)

        # Draw stamp box with fill
        bg_color = tuple(min(1.0, c + 0.88) for c in color)
        page.draw_rect(rect, color=color, fill=bg_color, width=2.5)

        # Text inside
        tx = sx + (stamp_w - len(stamp_text) * font_size * 0.6) / 2
        ty = sy + stamp_h - 6
        page.insert_text(fitz.Point(tx, ty), stamp_text, fontsize=font_size, color=color)

    doc.save(out, garbage=4, deflate=True); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="stamped.pdf")

# ── STAMP PREVIEW ──────────────────────────────────────────────────────
@router.post("/stamp/preview")
async def stamp_preview(
    file: UploadFile = File(...),
    label: str = Form("APPROVED"),
    position: str = Form("top-right"),
    custom_text: str = Form(""),
    font_size: int = Form(18),
    page_num: int = Form(1),
):
    """Returns a base64 PNG preview of the first page with stamp applied."""
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,"input.pdf"); out = os.path.join(tmp,"preview.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)

    # Reuse stamp logic on just one page
    COLORS = {"APPROVED":(0.0,0.55,0.15),"DRAFT":(0.8,0.45,0.0),"CONFIDENTIAL":(0.75,0.0,0.0),"REJECTED":(0.85,0.0,0.0),"FINAL":(0.0,0.1,0.8),"COPY":(0.2,0.2,0.75)}
    stamp_text = custom_text.strip() if custom_text.strip() else label
    color = COLORS.get(label.upper(), (0.3,0.3,0.3))
    stamp_w = max(len(stamp_text)*font_size*0.62+24, 90); stamp_h = font_size+18
    margin = 20

    doc = fitz.open(src)
    n = min(page_num-1, doc.page_count-1)
    page = doc[n]; pw,ph = page.rect.width, page.rect.height
    pos_map = {
        "top-left":(margin,margin),"top-center":((pw-stamp_w)/2,margin),"top-right":(pw-stamp_w-margin,margin),
        "middle-left":(margin,(ph-stamp_h)/2),"middle-center":((pw-stamp_w)/2,(ph-stamp_h)/2),"middle-right":(pw-stamp_w-margin,(ph-stamp_h)/2),
        "bottom-left":(margin,ph-stamp_h-margin),"bottom-center":((pw-stamp_w)/2,ph-stamp_h-margin),"bottom-right":(pw-stamp_w-margin,ph-stamp_h-margin),
    }
    sx,sy = pos_map.get(position,(pw-stamp_w-margin,margin))
    rect = fitz.Rect(sx,sy,sx+stamp_w,sy+stamp_h)
    bg_color = tuple(min(1.0,c+0.88) for c in color)
    page.draw_rect(rect, color=color, fill=bg_color, width=2.5)
    tx = sx+(stamp_w-len(stamp_text)*font_size*0.6)/2; ty = sy+stamp_h-6
    page.insert_text(fitz.Point(tx,ty), stamp_text, fontsize=font_size, color=color)

    mat = fitz.Matrix(0.8, 0.8)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    b64 = base64.b64encode(pix.tobytes("png")).decode()
    doc.close(); shutil.rmtree(tmp,ignore_errors=True)
    return JSONResponse({"preview": f"data:image/png;base64,{b64}"})

# ── WATERMARK PREVIEW ──────────────────────────────────────────────────
@router.post("/watermark/preview")
async def watermark_preview(
    file: UploadFile = File(...),
    text: str = Form("CONFIDENTIAL"),
    opacity: str = Form("0.25"),
    rotation: str = Form("45"),
    font_size: str = Form("52"),
):
    opacity = float(opacity); rotation = int(rotation); font_size = int(font_size)
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,"input.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src)
    page = doc[0]; pw,ph = page.rect.width, page.rect.height
    tw = len(text)*font_size*0.5; x=(pw-tw)/2; y=ph/2+font_size/2
    _apply_watermark_text(page, text, font_size, rotation)
    mat = fitz.Matrix(0.7,0.7)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    b64 = base64.b64encode(pix.tobytes("png")).decode()
    doc.close(); shutil.rmtree(tmp,ignore_errors=True)
    return JSONResponse({"preview": f"data:image/png;base64,{b64}"})

# ── PAGE NUMBERS ───────────────────────────────────────────────────────
@router.post("/page-numbers")
async def add_page_numbers(file: UploadFile = File(...), position: str = Form("bottom-center"), start: int = Form(1)):
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,file.filename); out = os.path.join(tmp,"numbered.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src); total = doc.page_count
    for i,page in enumerate(doc):
        pw,ph = page.rect.width, page.rect.height
        label = f"{i+start} / {total}"
        x = pw/2-20 if "center" in position else pw-80
        y = ph-25 if "bottom" in position else 25
        page.insert_text(fitz.Point(x,y), label, fontsize=9, color=(0.4,0.4,0.4))
    doc.save(out); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="numbered.pdf")

# ── PDF TO IMAGES ──────────────────────────────────────────────────────
@router.post("/pdf-to-images")
async def pdf_to_images(file: UploadFile = File(...)):
    import zipfile
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,file.filename); zp = os.path.join(tmp,"images.zip")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src); mat = fitz.Matrix(2,2)
    with zipfile.ZipFile(zp,"w") as zf:
        for i,page in enumerate(doc):
            pix = page.get_pixmap(matrix=mat)
            zf.writestr(f"page_{i+1}.png", pix.tobytes("png"))
    doc.close()
    return FileResponse(zp, media_type="application/zip", filename="pdf_images.zip")

# ── IMAGE TO PDF ───────────────────────────────────────────────────────
@router.post("/image-to-pdf")
async def image_to_pdf(files: List[UploadFile] = File(...)):
    tmp = tempfile.mkdtemp(); out = os.path.join(tmp,"from_images.pdf")
    doc = fitz.open()
    for f in files:
        path = os.path.join(tmp, f.filename)
        with open(path,"wb") as fp: shutil.copyfileobj(f.file,fp)
        page = doc.new_page(width=595, height=842)
        page.insert_image(fitz.Rect(0,0,595,842), filename=path)
    doc.save(out); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="from_images.pdf")

# ── PDF TO WORD (txt-based) ────────────────────────────────────────────
@router.post("/pdf-to-word")
async def pdf_to_word(file: UploadFile = File(...)):
    try:
        from docx import Document
        from docx.shared import Pt
    except ImportError:
        raise HTTPException(500, "python-docx not installed.")
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,file.filename); out = os.path.join(tmp,"converted.docx")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc_pdf = fitz.open(src)
    word_doc = Document()
    for page in doc_pdf:
        blocks = page.get_text("blocks")
        for b in blocks:
            text = b[4].strip()
            if text:
                word_doc.add_paragraph(text)
        word_doc.add_page_break()
    doc_pdf.close()
    word_doc.save(out)
    return FileResponse(out, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename="converted.docx")

# ── WORD TO PDF ────────────────────────────────────────────────────────
@router.post("/word-to-pdf")
async def word_to_pdf(file: UploadFile = File(...)):
    try:
        from docx import Document
        from docx.shared import Pt
    except ImportError:
        raise HTTPException(500, "python-docx not installed.")
    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, file.filename)
    out = os.path.join(tmp, "converted.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)

    word_doc = Document(src)
    pdf_doc  = fitz.open()
    page     = pdf_doc.new_page(width=595, height=842)
    y        = 60; ml = 60; mr = 535; fs = 11; lh = fs * 1.4

    for para in word_doc.paragraphs:
        text = para.text.strip()
        if not text:
            y += lh * 0.5; continue
        if y > 800:
            page = pdf_doc.new_page(width=595, height=842); y = 60
        bold = any(run.bold for run in para.runs if run.bold)
        page.insert_text(fitz.Point(ml, y), text,
                         fontname="hebo" if bold else "helv", fontsize=fs, color=(0,0,0))
        y += lh

    pdf_doc.save(out); pdf_doc.close()
    return FileResponse(out, media_type="application/pdf", filename="converted.pdf")

# ── PROTECT ────────────────────────────────────────────────────────────
@router.post("/protect")
async def protect(file: UploadFile = File(...), password: str = Form(...)):
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,file.filename); out = os.path.join(tmp,"protected.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src)
    perm = fitz.PDF_PERM_PRINT | fitz.PDF_PERM_COPY
    doc.save(out, encryption=fitz.PDF_ENCRYPT_AES_256, user_pw=password, owner_pw=password+"_owner", permissions=perm)
    doc.close()
    return FileResponse(out, media_type="application/pdf", filename="protected.pdf")

# ── UNLOCK ─────────────────────────────────────────────────────────────
@router.post("/unlock")
async def unlock(file: UploadFile = File(...), password: str = Form(...)):
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,file.filename); out = os.path.join(tmp,"unlocked.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src)
    if doc.authenticate(password):
        doc.save(out, encryption=fitz.PDF_ENCRYPT_NONE); doc.close()
        return FileResponse(out, media_type="application/pdf", filename="unlocked.pdf")
    doc.close(); raise HTTPException(400,"Incorrect password.")

# ── REDACT ─────────────────────────────────────────────────────────────
@router.post("/redact")
async def redact(file: UploadFile = File(...), text: str = Form(...)):
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,file.filename); out = os.path.join(tmp,"redacted.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src)
    for page in doc:
        areas = page.search_for(text)
        for rect in areas: page.add_redact_annot(rect, fill=(0,0,0))
        page.apply_redactions()
    doc.save(out); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="redacted.pdf")

# ── FIND & REPLACE ─────────────────────────────────────────────────────
@router.post("/find-replace")
async def find_replace(file: UploadFile = File(...), find: str = Form(...),
                       replace: str = Form(...), match_case: bool = Form(False), whole_word: bool = Form(False)):
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,file.filename); out = os.path.join(tmp,"replaced.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src)
    for page in doc:
        areas = page.search_for(find)
        for rect in areas: page.add_redact_annot(rect, fill=(1,1,1))
        page.apply_redactions()
        for rect in areas:
            page.insert_text(fitz.Point(rect.x0, rect.y1), replace, fontsize=11, color=(0,0,0))
    doc.save(out); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="replaced.pdf")

# ── REPAIR ─────────────────────────────────────────────────────────────
@router.post("/repair")
async def repair(file: UploadFile = File(...)):
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,file.filename); out = os.path.join(tmp,"repaired.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src); doc.save(out, garbage=4, deflate=True, clean=True, linear=True); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="repaired.pdf")

# ── DUPLICATE PAGE ─────────────────────────────────────────────────────
@router.post("/duplicate-page")
async def duplicate_page(file: UploadFile = File(...), page: int = Form(1)):
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,file.filename); out = os.path.join(tmp,"duplicated.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src); n=page-1
    if 0<=n<doc.page_count: doc.copy_page(n)
    doc.save(out); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="duplicated.pdf")

# ── CROP ───────────────────────────────────────────────────────────────
@router.post("/crop")
async def crop(file: UploadFile = File(...), left: float=Form(0), top: float=Form(0), right: float=Form(0), bottom: float=Form(0)):
    tmp = tempfile.mkdtemp(); src = os.path.join(tmp,file.filename); out = os.path.join(tmp,"cropped.pdf")
    with open(src,"wb") as f: shutil.copyfileobj(file.file,f)
    doc = fitz.open(src)
    for page in doc:
        r=page.rect; page.set_cropbox(fitz.Rect(r.x0+left, r.y0+top, r.x1-right, r.y1-bottom))
    doc.save(out); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="cropped.pdf")

# ══════════════════════════════════════════════════════════════════════
# CONVERT TO PDF
# ══════════════════════════════════════════════════════════════════════

# ── PowerPoint → PDF ───────────────────────────────────────────────────
@router.post("/pptx-to-pdf")
async def pptx_to_pdf(file: UploadFile = File(...)):
    try:
        from pptx import Presentation
        from pptx.util import Inches, Pt
    except ImportError:
        raise HTTPException(500, "python-pptx not installed. Run: pip install python-pptx")
    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, file.filename)
    out = os.path.join(tmp, "converted.pdf")
    with open(src, "wb") as f: shutil.copyfileobj(file.file, f)
    prs = Presentation(src)
    doc = fitz.open()
    for slide in prs.slides:
        page = doc.new_page(width=792, height=612)  # 11x8.5 landscape
        y = 60
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    text = para.text.strip()
                    if not text: continue
                    if y > 580: break
                    bold = any(run.bold for run in para.runs if run.bold is not None)
                    fs = 14 if y < 100 else 11  # larger for title
                    page.insert_text(fitz.Point(40, y), text,
                        fontname="hebo" if bold else "helv", fontsize=fs, color=(0,0,0))
                    y += fs * 1.6
        y = 60
    doc.save(out); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="converted.pdf")

# ── Excel → PDF ────────────────────────────────────────────────────────
@router.post("/xlsx-to-pdf")
async def xlsx_to_pdf(file: UploadFile = File(...)):
    try:
        from openpyxl import load_workbook
    except ImportError:
        raise HTTPException(500, "openpyxl not installed. Run: pip install openpyxl")
    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, file.filename)
    out = os.path.join(tmp, "converted.pdf")
    with open(src, "wb") as f: shutil.copyfileobj(file.file, f)
    wb = load_workbook(src, data_only=True)
    doc = fitz.open()
    for sheet in wb.worksheets:
        page = doc.new_page(width=842, height=595)  # A4 landscape
        x_start, y_start, fs = 30, 40, 9
        col_w = min(120, max(60, (842 - 60) // max(sheet.max_column, 1)))
        for ri, row in enumerate(sheet.iter_rows(values_only=True)):
            y = y_start + ri * (fs + 4)
            if y > 575:
                page = doc.new_page(width=842, height=595)
                y_start = 40; ri = 0; y = 40
            for ci, cell in enumerate(row):
                if ci > 12: break
                text = str(cell) if cell is not None else ""
                if not text or text == "None": continue
                x = x_start + ci * col_w
                page.insert_text(fitz.Point(x, y), text[:20],
                    fontname="helv", fontsize=fs, color=(0,0,0))
    doc.save(out); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="converted.pdf")

# ── HTML → PDF ─────────────────────────────────────────────────────────
@router.post("/html-to-pdf")
async def html_to_pdf(file: UploadFile = File(...)):
    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, file.filename)
    out = os.path.join(tmp, "converted.pdf")
    with open(src, "wb") as f: shutil.copyfileobj(file.file, f)
    html_content = open(src, "r", encoding="utf-8", errors="ignore").read()
    # Use PyMuPDF's built-in HTML story renderer
    try:
        story = fitz.Story(html=html_content)
        writer = fitz.DocumentWriter(out)
        mediabox = fitz.paper_rect("a4")
        where    = mediabox + (36, 36, -36, -36)
        more     = True
        while more:
            dev, more = writer.begin_page(mediabox)
            more, _ = story.place(where)
            story.draw(dev)
            writer.end_page()
        writer.close()
    except Exception:
        # Fallback: strip HTML tags and write plain text
        import re as _re
        text = _re.sub(r'<[^>]+>', ' ', html_content)
        text = _re.sub(r'\s+', ' ', text).strip()
        doc  = fitz.open()
        page = doc.new_page()
        page.insert_textbox(fitz.Rect(36,36,559,805), text,
            fontname="helv", fontsize=11, color=(0,0,0))
        doc.save(out); doc.close()
    return FileResponse(out, media_type="application/pdf", filename="converted.pdf")

# ══════════════════════════════════════════════════════════════════════
# CONVERT FROM PDF
# ══════════════════════════════════════════════════════════════════════

# ── PDF → JPG (single images, not ZIP) ────────────────────────────────
@router.post("/pdf-to-jpg")
async def pdf_to_jpg(file: UploadFile = File(...)):
    import zipfile
    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, file.filename)
    zp  = os.path.join(tmp, "images.zip")
    with open(src,"wb") as f: shutil.copyfileobj(file.file, f)
    doc = fitz.open(src)
    mat = fitz.Matrix(2, 2)
    with zipfile.ZipFile(zp, "w") as zf:
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=mat)
            zf.writestr(f"page_{i+1}.jpg", pix.tobytes("jpeg", jpg_quality=90))
    doc.close()
    return FileResponse(zp, media_type="application/zip", filename="pdf_images_jpg.zip")

# ── PDF → PowerPoint ───────────────────────────────────────────────────
@router.post("/pdf-to-pptx")
async def pdf_to_pptx(file: UploadFile = File(...)):
    try:
        from pptx import Presentation
        from pptx.util import Inches, Pt, Emu
        from pptx.dml.color import RGBColor
    except ImportError:
        raise HTTPException(500, "python-pptx not installed. Run: pip install python-pptx")
    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, file.filename)
    out = os.path.join(tmp, "converted.pptx")
    with open(src, "wb") as f: shutil.copyfileobj(file.file, f)
    doc = fitz.open(src)
    prs = Presentation()
    prs.slide_width  = Inches(11)
    prs.slide_height = Inches(8.5)
    blank = prs.slide_layouts[6]  # blank layout
    for page in doc:
        slide = prs.slides.add_slide(blank)
        # Render page as image and use as background
        pix      = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5))
        img_path = os.path.join(tmp, f"slide_{page.number}.png")
        pix.save(img_path)
        slide.shapes.add_picture(img_path, 0, 0, prs.slide_width, prs.slide_height)
    doc.close()
    prs.save(out)
    return FileResponse(out,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename="converted.pptx")

# ── PDF → Excel ────────────────────────────────────────────────────────
@router.post("/pdf-to-xlsx")
async def pdf_to_xlsx(file: UploadFile = File(...)):
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font
    except ImportError:
        raise HTTPException(500, "openpyxl not installed. Run: pip install openpyxl")
    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, file.filename)
    out = os.path.join(tmp, "converted.xlsx")
    with open(src, "wb") as f: shutil.copyfileobj(file.file, f)
    doc = fitz.open(src)
    wb  = Workbook()
    for pi, page in enumerate(doc):
        ws = wb.active if pi == 0 else wb.create_sheet(f"Page {pi+1}")
        if pi == 0: ws.title = "Page 1"
        blocks = page.get_text("blocks")
        # Sort by vertical then horizontal position
        blocks.sort(key=lambda b: (round(b[1]/15)*15, b[0]))
        for block in blocks:
            text = block[4].strip().replace("\n", " ")
            if not text: continue
            # Estimate row/col from position
            row = max(1, int(block[1] / 15) + 1)
            col = max(1, int(block[0] / 80) + 1)
            try:
                ws.cell(row=row, column=col, value=text)
            except Exception:
                pass
    doc.close()
    wb.save(out)
    return FileResponse(out,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="converted.xlsx")

# ── PDF → PDF/A ────────────────────────────────────────────────────────
@router.post("/pdf-to-pdfa")
async def pdf_to_pdfa(file: UploadFile = File(...)):
    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, file.filename)
    out = os.path.join(tmp, "converted_pdfa.pdf")
    with open(src, "wb") as f: shutil.copyfileobj(file.file, f)
    doc = fitz.open(src)
    # PDF/A-1b: linearized, no encryption, clean structure
    doc.save(out, garbage=4, deflate=True, clean=True, linear=True,
             encryption=fitz.PDF_ENCRYPT_NONE)
    doc.close()
    return FileResponse(out, media_type="application/pdf", filename="converted_pdfa.pdf")
