"""Generates the representative test PDFs (dev/test only; *.pdf is git-ignored).
Needs: reportlab, pikepdf.   python3 make_fixtures.py
"""
import os, io
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.colors import Color
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image
import pikepdf

HERE = os.path.dirname(os.path.abspath(__file__))
out = lambda n: os.path.join(HERE, n)

def png_bytes():
    im = Image.new("RGB", (60, 60), (200, 40, 40))
    b = io.BytesIO(); im.save(b, "PNG"); b.seek(0); return b

# 1. resume.pdf -- A4, 2 pages, std fonts, colours, background band, image, right-aligned dates
c = canvas.Canvas(out("resume.pdf"), pagesize=A4, pageCompression=1)
W, H = A4
c.setFillColor(Color(0.90, 0.92, 0.97)); c.rect(0, H-90, W, 90, fill=1, stroke=0)   # header band (must survive edits)
c.setFillColor(Color(0.1, 0.2, 0.5)); c.setFont("Helvetica-Bold", 24); c.drawString(50, H-55, "Jane Doe")
c.setFillColor(Color(0.3, 0.3, 0.3)); c.setFont("Helvetica", 11); c.drawString(50, H-75, "Software Developer")
c.drawImage(__import__("reportlab.lib.utils", fromlist=["ImageReader"]).ImageReader(png_bytes()), W-110, H-80, 50, 50)
y = H-130
c.setFillColor(Color(0.1, 0.2, 0.5)); c.setFont("Helvetica-Bold", 14); c.drawString(50, y, "Experience"); y -= 22
c.setFillColor(Color(0, 0, 0)); c.setFont("Helvetica-Bold", 11); c.drawString(50, y, "Acme Corp"); c.setFont("Helvetica", 11); c.drawRightString(W-50, y, "2020 - 2023"); y -= 16
c.setFont("Times-Italic", 11); c.drawString(50, y, "Backend engineer working on payments"); y -= 18
c.setFont("Helvetica", 10)
for line in ["Built and maintained REST services handling two million requests per day.",
             "Reduced infrastructure cost by thirty percent through caching and batching.",
             "Mentored four junior engineers and led weekly design reviews."]:
    c.drawString(62, y, "\u2022 " if False else "- "); c.drawString(72, y, line); y -= 14
y -= 10
c.setFillColor(Color(0.1, 0.2, 0.5)); c.setFont("Helvetica-Bold", 14); c.drawString(50, y, "Education"); y -= 22
c.setFillColor(Color(0, 0, 0)); c.setFont("Helvetica", 11); c.drawString(50, y, "BSc Computer Science, State University"); y -= 16
c.setFont("Courier", 10); c.drawString(50, y, "GPA 3.8 / 4.0")
c.showPage()
c.setFont("Helvetica-Bold", 14); c.setFillColor(Color(0.1, 0.2, 0.5)); c.drawString(50, H-60, "Skills")
c.setFillColor(Color(0, 0, 0)); c.setFont("Helvetica", 11); c.drawString(50, H-82, "Python, JavaScript, SQL, Docker")
c.save()

# 2. ttf.pdf -- embedded TrueType (DejaVu): original font cannot be reproduced -> fallback warning
pdfmetrics.registerFont(TTFont("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
c = canvas.Canvas(out("ttf.pdf"), pagesize=letter)
c.setFont("DejaVu", 12); c.drawString(72, 700, "Embedded font line"); c.drawString(72, 680, "Another embedded line")
c.save()

# 3. form.pdf -- text living inside a Form XObject (cannot be safely edited in place)
c = canvas.Canvas(out("form.pdf"), pagesize=letter)
c.beginForm("f1"); c.setFont("Helvetica", 12); c.drawString(72, 700, "Inside a form xobject"); c.endForm()
c.doForm("f1"); c.setFont("Helvetica", 12); c.drawString(72, 650, "Plain text line"); c.save()

# 4. rotated.pdf -- /Rotate 90 (unsupported for editing -> read-only, warned)
with pikepdf.open(out("resume.pdf")) as p:
    p.pages[0].Rotate = 90
    p.save(out("rotated.pdf"))

# 5. encrypted.pdf
with pikepdf.open(out("resume.pdf")) as p:
    p.save(out("encrypted.pdf"), encryption=pikepdf.Encryption(user="secret", owner="owner"))

# 6. corrupt.pdf -- truncated
data = open(out("resume.pdf"), "rb").read()
open(out("corrupt.pdf"), "wb").write(data[: len(data)//3])

# 7. many.pdf -- 60 pages for responsiveness / limits
c = canvas.Canvas(out("many.pdf"), pagesize=letter)
for i in range(60):
    c.setFont("Helvetica", 12)
    for j in range(40): c.drawString(60, 740-j*16, f"Page {i+1} line {j+1} lorem ipsum dolor sit amet consectetur")
    c.showPage()
c.save()

# 8. scan.pdf -- image only, no text layer
im = Image.new("RGB", (600, 800), (250, 250, 250)); im.save(out("scan.pdf"), "PDF")
print("fixtures ok")

# 9. paragraphs.pdf -- reflow fixture: headings, wrapped paragraphs, row-anchored dates, page 1 filled to the margin
from reportlab.lib.utils import simpleSplit
c = canvas.Canvas(out("paragraphs.pdf"), pagesize=letter)
Wl, Hl = letter
lorem = ("Designed and shipped a distributed billing platform used by thousands of customers, improving reliability and "
         "reducing latency across regions while mentoring teammates and documenting architecture decisions for the whole organisation.")
def para(c, y, text, font="Helvetica", size=10, x=60, width=470):
    c.setFont(font, size)
    for ln in simpleSplit(text, font, size, width):
        c.drawString(x, y, ln); y -= size*1.3
    return y
for pg in range(2):
    y = Hl - 60
    for sec in range(1, 4 if pg == 0 else 2):
        c.setFont("Helvetica-Bold", 14); c.setFillColor(Color(0.1,0.2,0.5)); c.drawString(60, y, f"Section {pg*3+sec}"); y -= 22
        c.setFillColor(Color(0,0,0))
        c.setFont("Helvetica-Bold", 11); c.drawString(60, y, f"Company {pg*3+sec}"); c.setFont("Helvetica", 11); c.drawRightString(Wl-80, y, f"20{10+sec} - 20{12+sec}"); y -= 16
        for k in range(2 if pg == 0 else 1):
            y = para(c, y, lorem); y -= 8
        y -= 6
    if pg == 0:
        while y > 100:   # fill page 1 down to the margin
            y = para(c, y, lorem); y -= 8
    c.showPage()
c.save()
