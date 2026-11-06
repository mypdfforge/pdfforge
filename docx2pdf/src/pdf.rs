// Layout -> PDF. Embeds font variants and images as XObjects.
use crate::layout::{FaceSet, LPage};
use crate::model::{Doc, Page};
use pdf_writer::{types::*, Content, Filter, Name, Pdf, Rect, Ref, Str};
use std::collections::{BTreeMap, HashMap};

fn deflate(b: &[u8]) -> Vec<u8> {
    miniz_oxide::deflate::compress_to_vec_zlib(b, 6)
}

pub struct FontBytesSet<'a> {
    pub regular: &'a [u8],
    pub bold: Option<&'a [u8]>,
    pub italic: Option<&'a [u8]>,
    pub bold_italic: Option<&'a [u8]>,
    pub fallbacks: &'a [Vec<u8>],
}

fn font_variant_index(bold: bool, italic: bool, fonts: &FontBytesSet, faces: &FaceSet) -> usize {
    match (bold, italic) {
        (true, true) => {
            if fonts.bold_italic.is_some() && faces.bold_italic.is_some() { 3 }
            else if fonts.bold.is_some() && faces.bold.is_some() { 1 }
            else if fonts.italic.is_some() && faces.italic.is_some() { 2 }
            else { 0 }
        }
        (true, false) => {
            if fonts.bold.is_some() && faces.bold.is_some() { 1 } else { 0 }
        }
        (false, true) => {
            if fonts.italic.is_some() && faces.italic.is_some() { 2 } else { 0 }
        }
        (false, false) => 0,
    }
}

pub fn write(
    pages: &[LPage],
    page: &Page,
    doc: &Doc,
    font_bytes: &FontBytesSet,
    faces: &FaceSet,
) -> Vec<u8> {
    let mut pdf = Pdf::new();
    let cat = Ref::new(1);
    let tree = Ref::new(2);
    let mut next = 10;
    let mut alloc = || {
        next += 1;
        Ref::new(next)
    };

    pdf.catalog(cat).pages(tree);

    // Collect used glyphs for primary variants and fallbacks
    let mut used: [BTreeMap<u16, char>; 4] = [
        BTreeMap::new(),
        BTreeMap::new(),
        BTreeMap::new(),
        BTreeMap::new(),
    ];
    let mut fb_used: Vec<BTreeMap<u16, char>> = vec![BTreeMap::new(); faces.fallbacks.len()];

    for p in pages {
        for l in &p.lines {
            for s in &l.spans {
                for c in s.text.chars() {
                    if !crate::layout::is_symbol(c) {
                        let (_, gid, font_idx) = faces.find_glyph(c, s.bold, s.italic);
                        if gid.0 != 0 {
                            if font_idx == 0 {
                                let idx = font_variant_index(s.bold, s.italic, font_bytes, faces);
                                used[idx].insert(gid.0, c);
                            } else if font_idx - 1 < fb_used.len() {
                                fb_used[font_idx - 1].insert(gid.0, c);
                            }
                        }
                    }
                }
            }
        }
    }

    struct VariantMeta {
        tag: &'static [u8],
        base_name: &'static [u8],
        is_bold: bool,
        is_italic: bool,
    }

    let metas = [
        VariantMeta { tag: b"F1", base_name: b"CustomFont-Regular", is_bold: false, is_italic: false },
        VariantMeta { tag: b"F2", base_name: b"CustomFont-Bold", is_bold: true, is_italic: false },
        VariantMeta { tag: b"F3", base_name: b"CustomFont-Italic", is_bold: false, is_italic: true },
        VariantMeta { tag: b"F4", base_name: b"CustomFont-BoldItalic", is_bold: true, is_italic: true },
    ];

    let mut active_font_pairs: Vec<(&'static [u8], Ref)> = Vec::new();

    for idx in 0..4 {
        let bytes_opt = match idx {
            0 => Some(font_bytes.regular),
            1 => font_bytes.bold,
            2 => font_bytes.italic,
            3 => font_bytes.bold_italic,
            _ => None,
        };

        let face_opt = match idx {
            0 => Some(faces.regular),
            1 => faces.bold,
            2 => faces.italic,
            3 => faces.bold_italic,
            _ => None,
        };

        if idx > 0 && used[idx].is_empty() {
            continue;
        }

        if let (Some(bytes), Some(face)) = (bytes_opt, face_opt) {
            let meta = &metas[idx];
            let font_id = alloc();
            let cid_id = alloc();
            let desc_id = alloc();
            let file_id = alloc();
            let tou_id = alloc();

            active_font_pairs.push((meta.tag, font_id));

            let name = Name(meta.base_name);
            let upm = face.units_per_em() as f32;
            let scale = 1000.0 / upm;

            let subsetted = crate::subset::subset_ttf(bytes, &used[idx]);
            let comp = deflate(&subsetted);
            pdf.stream(file_id, &comp)
                .filter(Filter::FlateDecode)
                .pair(Name(b"Length1"), subsetted.len() as i32);

            let bb = face.global_bounding_box();
            let mut flags = FontFlags::NON_SYMBOLIC;
            if meta.is_italic {
                flags |= FontFlags::ITALIC;
            }

            pdf.font_descriptor(desc_id)
                .name(name)
                .flags(flags)
                .bbox(Rect::new(
                    bb.x_min as f32 * scale,
                    bb.y_min as f32 * scale,
                    bb.x_max as f32 * scale,
                    bb.y_max as f32 * scale,
                ))
                .italic_angle(if meta.is_italic { -12.0 } else { 0.0 })
                .ascent(face.ascender() as f32 * scale)
                .descent(face.descender() as f32 * scale)
                .cap_height(700.0)
                .stem_v(if meta.is_bold { 120.0 } else { 80.0 })
                .font_file2(file_id);

            {
                let mut cid = pdf.cid_font(cid_id);
                cid.subtype(CidFontType::Type2)
                    .base_font(name)
                    .system_info(SystemInfo {
                        registry: Str(b"Adobe"),
                        ordering: Str(b"Identity"),
                        supplement: 0,
                    })
                    .font_descriptor(desc_id)
                    .default_width(0.0)
                    .cid_to_gid_map_predefined(Name(b"Identity"));

                let mut w = cid.widths();
                for (&g, _) in &used[idx] {
                    let adv = face.glyph_hor_advance(ttf_parser::GlyphId(g)).unwrap_or(0) as f32 * scale;
                    w.consecutive(g, [adv]);
                }
            }

            let mut cmap = String::from(
                "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n",
            );
            let items: Vec<_> = used[idx].iter().collect();
            for chunk in items.chunks(100) {
                cmap += &format!("{} beginbfchar\n", chunk.len());
                for (g, c) in chunk {
                    let mut buf = [0u16; 2];
                    let hex: String = c
                        .encode_utf16(&mut buf)
                        .iter()
                        .map(|u| format!("{:04X}", u))
                        .collect();
                    cmap += &format!("<{:04X}> <{}>\n", g, hex);
                }
                cmap += "endbfchar\n";
            }
            cmap += "endcmap CMapName currentdict /CMap defineresource pop end end\n";
            pdf.stream(tou_id, cmap.as_bytes());

            pdf.type0_font(font_id)
                .base_font(name)
                .encoding_predefined(Name(b"Identity-H"))
                .descendant_font(cid_id)
                .to_unicode(tou_id);
        }
    }

    // Embed fallback fonts
    let mut fb_active_font_pairs: Vec<(String, Ref)> = Vec::new();
    for (i, fb_face) in faces.fallbacks.iter().enumerate() {
        if i >= fb_used.len() || fb_used[i].is_empty() {
            continue;
        }
        let tag = format!("FB{}", i + 1);
        let fb_bytes = &font_bytes.fallbacks[i];
        let font_id = alloc();
        let cid_id = alloc();
        let desc_id = alloc();
        let file_id = alloc();
        let tou_id = alloc();

        fb_active_font_pairs.push((tag.clone(), font_id));

        let font_name = format!("CustomFallback-{}", i + 1);
        let name = Name(font_name.as_bytes());
        let upm = fb_face.units_per_em() as f32;
        let scale = 1000.0 / upm;

        let subsetted = crate::subset::subset_ttf(fb_bytes, &fb_used[i]);
        let comp = deflate(&subsetted);
        pdf.stream(file_id, &comp)
            .filter(Filter::FlateDecode)
            .pair(Name(b"Length1"), subsetted.len() as i32);

        let bb = fb_face.global_bounding_box();
        pdf.font_descriptor(desc_id)
            .name(name)
            .flags(FontFlags::NON_SYMBOLIC)
            .bbox(Rect::new(
                bb.x_min as f32 * scale,
                bb.y_min as f32 * scale,
                bb.x_max as f32 * scale,
                bb.y_max as f32 * scale,
            ))
            .ascent(fb_face.ascender() as f32 * scale)
            .descent(fb_face.descender() as f32 * scale)
            .cap_height(700.0)
            .stem_v(80.0)
            .font_file2(file_id);

        {
            let mut cid = pdf.cid_font(cid_id);
            cid.subtype(CidFontType::Type2)
                .base_font(name)
                .system_info(SystemInfo {
                    registry: Str(b"Adobe"),
                    ordering: Str(b"Identity"),
                    supplement: 0,
                })
                .font_descriptor(desc_id)
                .default_width(0.0)
                .cid_to_gid_map_predefined(Name(b"Identity"));

            let mut w = cid.widths();
            for (&g, _) in &fb_used[i] {
                let adv = fb_face.glyph_hor_advance(ttf_parser::GlyphId(g)).unwrap_or(0) as f32 * scale;
                w.consecutive(g, [adv]);
            }
        }

        let mut cmap = String::from(
            "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n",
        );
        let items: Vec<_> = fb_used[i].iter().collect();
        for chunk in items.chunks(100) {
            cmap += &format!("{} beginbfchar\n", chunk.len());
            for (g, c) in chunk {
                let mut buf = [0u16; 2];
                let hex: String = c
                    .encode_utf16(&mut buf)
                    .iter()
                    .map(|u| format!("{:04X}", u))
                    .collect();
                cmap += &format!("<{:04X}> <{}>\n", g, hex);
            }
            cmap += "endbfchar\n";
        }
        cmap += "endcmap CMapName currentdict /CMap defineresource pop end end\n";
        pdf.stream(tou_id, cmap.as_bytes());

        pdf.type0_font(font_id)
            .base_font(name)
            .encoding_predefined(Name(b"Identity-H"))
            .descendant_font(cid_id)
            .to_unicode(tou_id);
    }

    // Embed Images as XObjects
    let mut used_rel_ids: Vec<String> = Vec::new();
    for lp in pages {
        for img in &lp.images {
            if !used_rel_ids.contains(&img.rel_id) {
                used_rel_ids.push(img.rel_id.clone());
            }
        }
    }

    let mut image_pairs: Vec<(String, Ref)> = Vec::new();
    let mut rel_to_tag: HashMap<String, String> = HashMap::new();

    for (idx, rel_id) in used_rel_ids.into_iter().enumerate() {
        if let Some(img_data) = doc.images.get(&rel_id) {
            let tag = format!("Im{}", idx + 1);
            let img_ref = alloc();

            let smask_ref = if let Some(smask_data) = &img_data.smask_bytes {
                let sm_ref = alloc();
                let mut sm_obj = pdf.image_xobject(sm_ref, smask_data);
                sm_obj.width(img_data.width as i32);
                sm_obj.height(img_data.height as i32);
                sm_obj.color_space().device_gray();
                sm_obj.bits_per_component(8);
                sm_obj.filter(Filter::FlateDecode);
                Some(sm_ref)
            } else {
                None
            };

            let mut img_obj = pdf.image_xobject(img_ref, &img_data.bytes);
            img_obj.width(img_data.width as i32);
            img_obj.height(img_data.height as i32);
            img_obj.color_space().device_rgb();
            img_obj.bits_per_component(8);

            if let Some(sm_ref) = smask_ref {
                img_obj.s_mask(sm_ref);
            }

            if img_data.is_jpeg {
                img_obj.filter(Filter::DctDecode);
            } else {
                img_obj.filter(Filter::FlateDecode);
            }

            image_pairs.push((tag.clone(), img_ref));
            rel_to_tag.insert(rel_id, tag);
        }
    }

    // Pages
    let mut kids = vec![];
    for lp in pages {
        let (pid, cid) = (alloc(), alloc());
        kids.push(pid);
        let mut c = Content::new();

        // Draw vector rectangles (table cell shading)
        if !lp.rects.is_empty() {
            c.save_state();
            for r in &lp.rects {
                if let Some([cr, cg, cb]) = r.fill_color {
                    c.set_fill_rgb(cr as f32 / 255.0, cg as f32 / 255.0, cb as f32 / 255.0);
                    c.rect(r.x, r.y, r.w, r.h);
                    c.fill_nonzero();
                }
                if let Some([sr, sg, sb]) = r.stroke_color {
                    c.set_stroke_rgb(sr as f32 / 255.0, sg as f32 / 255.0, sb as f32 / 255.0);
                    c.set_line_width(r.stroke_width);
                    c.rect(r.x, r.y, r.w, r.h);
                    c.stroke();
                }
            }
            c.restore_state();
        }

        // Draw vector border lines (per-edge borders & callout accents)
        if !lp.lines_vector.is_empty() {
            c.save_state();
            for line in &lp.lines_vector {
                c.set_stroke_rgb(
                    line.color[0] as f32 / 255.0,
                    line.color[1] as f32 / 255.0,
                    line.color[2] as f32 / 255.0,
                );
                c.set_line_width(line.width);
                c.move_to(line.x1, line.y1);
                c.line_to(line.x2, line.y2);
                c.stroke();
            }
            c.restore_state();
        }

        // Draw images
        for img in &lp.images {
            if let Some(tag) = rel_to_tag.get(&img.rel_id) {
                c.save_state();
                c.transform([img.w, 0.0, 0.0, img.h, img.x, img.y]);
                c.x_object(Name(tag.as_bytes()));
                c.restore_state();
            }
        }

        let mut cur_color: Option<[u8; 3]> = None;
        for l in &lp.lines {
            for span in &l.spans {
                let base_y = l.y + span.y_offset;
                let cr = span.color[0] as f32 / 255.0;
                let cg = span.color[1] as f32 / 255.0;
                let cb = span.color[2] as f32 / 255.0;

                // Underline
                if span.underline {
                    c.save_state();
                    c.set_stroke_rgb(cr, cg, cb);
                    c.set_line_width((span.size * 0.06).max(0.75));
                    let uy = base_y - (span.size * 0.12).max(1.5);
                    c.move_to(span.x, uy);
                    c.line_to(span.x + span.width, uy);
                    c.stroke();
                    c.restore_state();
                }

                // Strikethrough
                if span.strikethrough {
                    c.save_state();
                    c.set_stroke_rgb(cr, cg, cb);
                    c.set_line_width((span.size * 0.06).max(0.75));
                    let sy = base_y + span.size * 0.3;
                    c.move_to(span.x, sy);
                    c.line_to(span.x + span.width, sy);
                    c.stroke();
                    c.restore_state();
                }

                if cur_color != Some(span.color) {
                    c.set_fill_rgb(cr, cg, cb);
                    cur_color = Some(span.color);
                }

                let idx = font_variant_index(span.bold, span.italic, font_bytes, faces);
                let _face = match idx {
                    1 => faces.bold.unwrap_or(faces.regular),
                    2 => faces.italic.unwrap_or(faces.regular),
                    3 => faces.bold_italic.or(faces.bold).or(faces.italic).unwrap_or(faces.regular),
                    _ => faces.regular,
                };
                let font_tag = metas[idx].tag;
                let mut cur_font_tag = font_tag.to_vec();

                let mut cur_x = span.x;
                let mut regular_bytes = Vec::new();
                let mut regular_start_x = cur_x;

                for ch in span.text.chars() {
                    if crate::layout::is_symbol(ch) {
                        if !regular_bytes.is_empty() {
                            c.begin_text()
                                .set_font(Name(&cur_font_tag), span.size)
                                .next_line(regular_start_x, base_y)
                                .show(Str(&regular_bytes))
                                .end_text();
                            regular_bytes.clear();
                        }

                        let sym_w = span.size * 0.75;
                        c.save_state();
                        c.set_stroke_rgb(cr, cg, cb);
                        match ch {
                            '✔' | '✓' => {
                                c.set_line_width((span.size * 0.12).max(1.0));
                                c.move_to(cur_x + sym_w * 0.15, base_y + span.size * 0.35);
                                c.line_to(cur_x + sym_w * 0.38, base_y + span.size * 0.12);
                                c.line_to(cur_x + sym_w * 0.85, base_y + span.size * 0.72);
                                c.stroke();
                            }
                            '✗' | '✕' => {
                                c.set_line_width((span.size * 0.12).max(1.0));
                                c.move_to(cur_x + sym_w * 0.2, base_y + span.size * 0.2);
                                c.line_to(cur_x + sym_w * 0.8, base_y + span.size * 0.75);
                                c.move_to(cur_x + sym_w * 0.8, base_y + span.size * 0.2);
                                c.line_to(cur_x + sym_w * 0.2, base_y + span.size * 0.75);
                                c.stroke();
                            }
                            '☐' => {
                                c.set_line_width((span.size * 0.08).max(0.75));
                                let box_sz = span.size * 0.65;
                                c.rect(cur_x + sym_w * 0.1, base_y + span.size * 0.12, box_sz, box_sz);
                                c.stroke();
                            }
                            '☑' => {
                                c.set_line_width((span.size * 0.08).max(0.75));
                                let box_sz = span.size * 0.65;
                                c.rect(cur_x + sym_w * 0.1, base_y + span.size * 0.12, box_sz, box_sz);
                                c.stroke();
                                c.set_line_width((span.size * 0.10).max(0.8));
                                c.move_to(cur_x + sym_w * 0.22, base_y + span.size * 0.40);
                                c.line_to(cur_x + sym_w * 0.38, base_y + span.size * 0.22);
                                c.line_to(cur_x + sym_w * 0.68, base_y + span.size * 0.62);
                                c.stroke();
                            }
                            _ => {}
                        }
                        c.restore_state();
                        cur_x += sym_w;
                        regular_start_x = cur_x;
                    } else {
                        let (_, gid, font_idx) = faces.find_glyph(ch, span.bold, span.italic);
                        let tag = if font_idx == 0 {
                            font_tag.to_vec()
                        } else {
                            format!("FB{}", font_idx).into_bytes()
                        };

                        if tag != cur_font_tag {
                            if !regular_bytes.is_empty() {
                                c.begin_text()
                                    .set_font(Name(&cur_font_tag), span.size)
                                    .next_line(regular_start_x, base_y)
                                    .show(Str(&regular_bytes))
                                    .end_text();
                                regular_bytes.clear();
                            }
                            cur_font_tag = tag;
                            regular_start_x = cur_x;
                        }

                        if regular_bytes.is_empty() {
                            regular_start_x = cur_x;
                        }
                        regular_bytes.extend_from_slice(&gid.0.to_be_bytes());
                        let cw = crate::layout::char_width(ch, faces, span.bold, span.italic, span.size);
                        cur_x += cw;
                    }
                }

                if !regular_bytes.is_empty() {
                    c.begin_text()
                        .set_font(Name(&cur_font_tag), span.size)
                        .next_line(regular_start_x, base_y)
                        .show(Str(&regular_bytes))
                        .end_text();
                }
            }
        }

        let data = deflate(&c.finish());
        pdf.stream(cid, &data).filter(Filter::FlateDecode);

        let mut pg = pdf.page(pid);
        pg.parent(tree)
            .media_box(Rect::new(0.0, 0.0, page.w_pt, page.h_pt))
            .contents(cid);

        let mut res = pg.resources();
        let mut fonts_res = res.fonts();
        for (tag, fid) in &active_font_pairs {
            fonts_res.pair(Name(tag), *fid);
        }
        for (tag, fid) in &fb_active_font_pairs {
            fonts_res.pair(Name(tag.as_bytes()), *fid);
        }
        drop(fonts_res);

        let mut xobjs_res = res.x_objects();
        for (tag, iref) in &image_pairs {
            xobjs_res.pair(Name(tag.as_bytes()), *iref);
        }
    }

    pdf.pages(tree).kids(kids.iter().copied()).count(kids.len() as i32);
    pdf.finish()
}
