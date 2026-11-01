import os
import docx
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import parse_xml, OxmlElement
from docx.oxml.ns import nsdecls, qn

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'docx_samples')
os.makedirs(FIXTURES_DIR, exist_ok=True)

# 1. Simple Resume (Zero blockers -> Quick mode)
doc_simple = Document()
doc_simple.add_heading("Alex Morgan", level=1)
doc_simple.add_paragraph("Senior Systems Engineer | alex.morgan@example.com | (555) 019-2834")
doc_simple.add_heading("Professional Summary", level=2)
doc_simple.add_paragraph("Experienced software engineer with 8+ years building scalable distributed architectures.")
doc_simple.add_heading("Experience", level=2)
doc_simple.add_paragraph("Principal Architect — Cloud Networks (2020 - Present)")
doc_simple.add_paragraph("• Architected low-latency message streaming pipelines handling 100k events/sec.")
doc_simple.save(os.path.join(FIXTURES_DIR, 'simple_resume.docx'))

# 2. Merged Cells Sample
doc_merged = Document()
doc_merged.add_heading("Quarterly Allocation Matrix", level=1)
tbl = doc_merged.add_table(rows=3, cols=3)
tbl.rows[0].cells[0].merge(tbl.rows[0].cells[2])
tbl.rows[0].cells[0].paragraphs[0].text = "Merged Header Across 3 Columns"
doc_merged.save(os.path.join(FIXTURES_DIR, 'sample_merged_cells.docx'))

# 3. Multi-Columns Sample
doc_cols = Document()
doc_cols.add_heading("Two Column Article", level=1)
section = doc_cols.sections[0]
sectPr = section._sectPr
cols = parse_xml(f'<w:cols {nsdecls("w")} w:num="2" w:space="720"/>')
sectPr.append(cols)
doc_cols.add_paragraph("This article is split into multiple columns across the page.")
doc_cols.save(os.path.join(FIXTURES_DIR, 'sample_columns.docx'))

# 4. Nested Table Sample
doc_nested = Document()
doc_nested.add_heading("Nested Table Hierarchy", level=1)
tbl_outer = doc_nested.add_table(rows=2, cols=2)
tbl_outer.rows[0].cells[0].paragraphs[0].text = "Outer Cell 1"
# Nesting a table inside outer cell 2
p = tbl_outer.rows[0].cells[1].paragraphs[0]
inner_tbl = tbl_outer.rows[0].cells[1].add_table(rows=2, cols=2)
inner_tbl.rows[0].cells[0].paragraphs[0].text = "Inner Nested Cell"
doc_nested.save(os.path.join(FIXTURES_DIR, 'sample_nested_table.docx'))

# 5. RTL Text Sample
doc_rtl = Document()
doc_rtl.add_heading("Arabic BiDi Document", level=1)
p_rtl = doc_rtl.add_paragraph()
pPr = p_rtl._p.get_or_add_pPr()
pPr.append(parse_xml(f'<w:bidi {nsdecls("w")}/>'))
r = p_rtl.add_run("مرحباً بكم في مستند الاختبار")
doc_rtl.save(os.path.join(FIXTURES_DIR, 'sample_rtl.docx'))

print("✓ All DOCX test fixtures generated successfully in:", FIXTURES_DIR)
