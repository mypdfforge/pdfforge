// DOCX -> Doc. Phase 2: styles.xml cascade and numbering.xml lists support.
use crate::model::*;
use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::HashMap;
use std::io::{Cursor, Read};

fn attr(e: &quick_xml::events::BytesStart, key: &[u8]) -> Option<String> {
    e.attributes().flatten().find(|a| a.key.local_name().as_ref() == key)
        .map(|a| String::from_utf8_lossy(&a.value).into_owned())
}

fn parse_numbering(xml: &str) -> Numbering {
    let mut numbering = Numbering::default();
    let mut r = Reader::from_str(xml);
    let mut cur_abstract_num: Option<AbstractNum> = None;
    let mut cur_level: Option<(usize, ListLevel)> = None;
    let mut cur_num_id: Option<String> = None;
    let mut in_lvl = false;
    let mut in_ppr = false;

    loop {
        match r.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"abstractNum" => {
                    if let Some(id) = attr(&e, b"abstractNumId") {
                        cur_abstract_num = Some(AbstractNum { id, levels: HashMap::new() });
                    }
                }
                b"lvl" => {
                    in_lvl = true;
                    let ilvl = attr(&e, b"ilvl").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
                    cur_level = Some((ilvl, ListLevel::default()));
                }
                b"start" if in_lvl => {
                    if let Some((_, lvl)) = cur_level.as_mut() {
                        if let Some(v) = attr(&e, b"val").and_then(|v| v.parse::<usize>().ok()) {
                            lvl.start = v;
                        }
                    }
                }
                b"numFmt" if in_lvl => {
                    if let Some((_, lvl)) = cur_level.as_mut() {
                        lvl.format = match attr(&e, b"val").as_deref() {
                            Some("bullet") => NumFmt::Bullet,
                            Some("lowerLetter") => NumFmt::LowerLetter,
                            Some("upperLetter") => NumFmt::UpperLetter,
                            Some("lowerRoman") => NumFmt::LowerRoman,
                            Some("upperRoman") => NumFmt::UpperRoman,
                            _ => NumFmt::Decimal,
                        };
                    }
                }
                b"lvlText" if in_lvl => {
                    if let Some((_, lvl)) = cur_level.as_mut() {
                        if let Some(txt) = attr(&e, b"val") {
                            lvl.lvl_text = txt;
                        }
                    }
                }
                b"pPr" if in_lvl => in_ppr = true,
                b"ind" if in_lvl && in_ppr => {
                    if let Some((_, lvl)) = cur_level.as_mut() {
                        if let Some(left) = attr(&e, b"left").and_then(|v| v.parse::<f32>().ok()) {
                            lvl.indent_pt = left / 20.0;
                        }
                        if let Some(hanging) = attr(&e, b"hanging").and_then(|v| v.parse::<f32>().ok()) {
                            lvl.hanging_pt = hanging / 20.0;
                        }
                    }
                }
                b"num" => {
                    cur_num_id = attr(&e, b"numId");
                }
                b"abstractNumId" => {
                    if let (Some(num_id), Some(abs_id)) = (cur_num_id.as_deref(), attr(&e, b"val")) {
                        numbering.num_to_abstract.insert(num_id.to_string(), abs_id);
                    }
                }
                _ => {}
            },
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"lvl" => {
                    in_lvl = false;
                    if let (Some(abs_num), Some((ilvl, lvl))) = (cur_abstract_num.as_mut(), cur_level.take()) {
                        abs_num.levels.insert(ilvl, lvl);
                    }
                }
                b"abstractNum" => {
                    if let Some(abs_num) = cur_abstract_num.take() {
                        numbering.abstract_nums.insert(abs_num.id.clone(), abs_num);
                    }
                }
                b"pPr" => in_ppr = false,
                b"num" => cur_num_id = None,
                _ => {}
            },
            Ok(Event::Eof) => break,
            _ => {}
        }
    }
    numbering
}

fn parse_styles(xml: &str) -> Styles {
    let mut styles = Styles::default();
    let mut r = Reader::from_str(xml);
    let mut cur_style: Option<Style> = None;
    let mut in_rpr = false;
    let mut in_ppr = false;
    let mut in_doc_defaults = false;

    loop {
        match r.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                match e.local_name().as_ref() {
                    b"docDefaults" => in_doc_defaults = true,
                    b"style" => {
                        let stype = match attr(&e, b"type").as_deref() {
                            Some("character") => StyleType::Character,
                            _ => StyleType::Paragraph,
                        };
                        let sid = attr(&e, b"styleId").unwrap_or_default();
                        cur_style = Some(Style {
                            style_id: sid,
                            style_type: stype,
                            ..Default::default()
                        });
                    }
                    b"basedOn" => {
                        if let Some(s) = cur_style.as_mut() {
                            s.based_on = attr(&e, b"val");
                        }
                    }
                    b"pPr" => in_ppr = true,
                    b"rPr" => in_rpr = true,
                    b"jc" if in_ppr => {
                        let a = match attr(&e, b"val").as_deref() {
                            Some("center") => Align::Center,
                            Some("right") | Some("end") => Align::Right,
                            _ => Align::Left,
                        };
                        if in_doc_defaults {
                            styles.default_style.align = Some(a);
                        } else if let Some(s) = cur_style.as_mut() {
                            s.align = Some(a);
                        }
                    }
                    b"spacing" if in_ppr => {
                        let parse_pt = |k: &[u8]| attr(&e, k).and_then(|v| v.parse::<f32>().ok()).map(|v| v / 20.0);
                        let before = parse_pt(b"before");
                        let after = parse_pt(b"after");
                        let line_mult = attr(&e, b"line").and_then(|v| v.parse::<f32>().ok()).map(|v| v / 240.0);

                        if in_doc_defaults {
                            if let Some(b) = before { styles.default_style.space_before_pt = Some(b); }
                            if let Some(a) = after { styles.default_style.space_after_pt = Some(a); }
                            if let Some(l) = line_mult { styles.default_style.line_spacing_mult = Some(l); }
                        } else if let Some(s) = cur_style.as_mut() {
                            if let Some(b) = before { s.space_before_pt = Some(b); }
                            if let Some(a) = after { s.space_after_pt = Some(a); }
                            if let Some(l) = line_mult { s.line_spacing_mult = Some(l); }
                        }
                    }
                    b"b" if in_rpr => {
                        let val = attr(&e, b"val").as_deref() != Some("0");
                        if in_doc_defaults {
                            styles.default_style.bold = Some(val);
                        } else if let Some(s) = cur_style.as_mut() {
                            s.bold = Some(val);
                        }
                    }
                    b"i" if in_rpr => {
                        let val = attr(&e, b"val").as_deref() != Some("0");
                        if in_doc_defaults {
                            styles.default_style.italic = Some(val);
                        } else if let Some(s) = cur_style.as_mut() {
                            s.italic = Some(val);
                        }
                    }
                    b"sz" if in_rpr => {
                        let sz = attr(&e, b"val").and_then(|v| v.parse::<f32>().ok()).map(|h| h / 2.0);
                        if in_doc_defaults {
                            styles.default_style.size_pt = sz;
                        } else if let Some(s) = cur_style.as_mut() {
                            s.size_pt = sz;
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"pPr" => in_ppr = false,
                b"rPr" => in_rpr = false,
                b"docDefaults" => in_doc_defaults = false,
                b"style" => {
                    if let Some(s) = cur_style.take() {
                        if !s.style_id.is_empty() {
                            styles.styles.insert(s.style_id.clone(), s);
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            _ => {}
        }
    }
    styles
}

fn parse_hex_color(hex: &str) -> Option<[u8; 3]> {
    let s = hex.trim().trim_start_matches('#');
    if s.len() == 6 {
        let r = u8::from_str_radix(&s[0..2], 16).ok()?;
        let g = u8::from_str_radix(&s[2..4], 16).ok()?;
        let b = u8::from_str_radix(&s[4..6], 16).ok()?;
        Some([r, g, b])
    } else {
        None
    }
}

fn parse_jpeg(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 { return None; }
    let mut i = 2;
    while i + 4 < data.len() {
        if data[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = data[i + 1];
        if marker == 0xD9 || marker == 0xDA { break; } // EOI or SOS
        let len = u16::from_be_bytes([data[i + 2], data[i + 3]]) as usize;
        // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
        if (marker >= 0xC0 && marker <= 0xC3) && marker != 0xC4 {
            if i + 9 <= data.len() {
                let h = u16::from_be_bytes([data[i + 5], data[i + 6]]) as u32;
                let w = u16::from_be_bytes([data[i + 7], data[i + 8]]) as u32;
                return Some((w, h));
            }
        }
        i += 2 + len;
    }
    None
}

fn parse_png(data: &[u8]) -> Option<(u32, u32, Vec<u8>, Option<Vec<u8>>)> {
    if data.len() < 33 || &data[0..8] != b"\x89PNG\r\n\x1a\n" { return None; }
    let width = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
    let height = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
    let bit_depth = data[24];
    let color_type = data[25];
    let compression = data[26];
    let filter = data[27];
    let interlace = data[28];

    if bit_depth != 8 || compression != 0 || filter != 0 || interlace != 0 {
        return None;
    }

    let mut idat_data = Vec::new();
    let mut i = 8;
    while i + 12 <= data.len() {
        let chunk_len = u32::from_be_bytes([data[i], data[i+1], data[i+2], data[i+3]]) as usize;
        let chunk_type = &data[i+4..i+8];
        if chunk_type == b"IDAT" {
            if i + 8 + chunk_len <= data.len() {
                idat_data.extend_from_slice(&data[i+8..i+8+chunk_len]);
            }
        } else if chunk_type == b"IEND" {
            break;
        }
        i += 12 + chunk_len;
    }

    let raw = miniz_oxide::inflate::decompress_to_vec_zlib(&idat_data).ok()?;

    let (bpp, has_alpha) = match color_type {
        2 => (3usize, false), // RGB
        6 => (4usize, true),  // RGBA
        _ => return None,
    };

    let stride = 1 + width as usize * bpp;
    if raw.len() < stride * height as usize { return None; }

    let mut uncompressed_rgb = Vec::with_capacity((width * height * 3) as usize);
    let mut uncompressed_alpha = if has_alpha {
        Some(Vec::with_capacity((width * height) as usize))
    } else {
        None
    };

    let mut prev_row = vec![0u8; width as usize * bpp];
    let mut cur_row = vec![0u8; width as usize * bpp];

    for y in 0..height as usize {
        let row_start = y * stride;
        let filter_type = raw[row_start];
        let row_bytes = &raw[row_start + 1..row_start + stride];

        for x in 0..cur_row.len() {
            let left = if x >= bpp { cur_row[x - bpp] } else { 0 };
            let up = prev_row[x];
            let up_left = if x >= bpp { prev_row[x - bpp] } else { 0 };
            let orig = row_bytes[x];

            let val = match filter_type {
                0 => orig,
                1 => orig.wrapping_add(left),
                2 => orig.wrapping_add(up),
                3 => orig.wrapping_add(((left as u16 + up as u16) / 2) as u8),
                4 => {
                    let p = left as i32 + up as i32 - up_left as i32;
                    let pa = (p - left as i32).abs();
                    let pb = (p - up as i32).abs();
                    let pc = (p - up_left as i32).abs();
                    let pr = if pa <= pb && pa <= pc { left } else if pb <= pc { up } else { up_left };
                    orig.wrapping_add(pr)
                }
                _ => orig,
            };
            cur_row[x] = val;
        }

        for pixel in cur_row.chunks_exact(bpp) {
            uncompressed_rgb.push(pixel[0]);
            uncompressed_rgb.push(pixel[1]);
            uncompressed_rgb.push(pixel[2]);
            if has_alpha {
                uncompressed_alpha.as_mut().unwrap().push(pixel[3]);
            }
        }

        prev_row.copy_from_slice(&cur_row);
    }

    let deflated_rgb = miniz_oxide::deflate::compress_to_vec_zlib(&uncompressed_rgb, 6);
    let deflated_alpha = uncompressed_alpha.map(|a| miniz_oxide::deflate::compress_to_vec_zlib(&a, 6));

    Some((width, height, deflated_rgb, deflated_alpha))
}

fn parse_header_footer(xml: &str, styles: &Styles) -> HeaderFooter {
    let mut hf = HeaderFooter::default();
    let mut r = Reader::from_str(xml);

    let mut current_p_style_id: Option<String> = None;
    let mut current_p_align: Option<Align> = None;
    let mut current_r_style_id: Option<String> = None;
    let mut current_r_bold: Option<bool> = None;
    let mut current_r_italic: Option<bool> = None;
    let mut current_r_size: Option<f32> = None;

    let (mut para, mut run) = (Para::default(), Run::default());
    let (mut in_t, mut in_ppr, mut in_rpr, mut in_instr) = (false, false, false, false);
    let mut instr_text = String::new();
    let mut active_field: Option<FieldType> = None;

    loop {
        match r.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"p" => {
                    para = Para::default();
                    current_p_style_id = None;
                    current_p_align = None;
                }
                b"pPr" => in_ppr = true,
                b"pStyle" if in_ppr => current_p_style_id = attr(&e, b"val"),
                b"jc" if in_ppr => current_p_align = match attr(&e, b"val").as_deref() {
                    Some("center") => Some(Align::Center),
                    Some("right") | Some("end") => Some(Align::Right),
                    _ => Some(Align::Left),
                },
                b"fldSimple" => {
                    let instr = attr(&e, b"instr").unwrap_or_default().to_uppercase();
                    if instr.contains("NUMPAGES") {
                        active_field = Some(FieldType::NumPages);
                    } else if instr.contains("PAGE") {
                        active_field = Some(FieldType::Page);
                    }
                }
                b"fldChar" => {
                    if let Some(char_type) = attr(&e, b"fldCharType") {
                        if char_type == "end" {
                            active_field = None;
                        }
                    }
                }
                b"r" => {
                    run = Run::default();
                    current_r_style_id = None;
                    current_r_bold = None;
                    current_r_italic = None;
                    current_r_size = None;
                }
                b"rPr" => in_rpr = true,
                b"rStyle" if in_rpr => current_r_style_id = attr(&e, b"val"),
                b"b" if in_rpr => current_r_bold = Some(attr(&e, b"val").as_deref() != Some("0")),
                b"i" if in_rpr => current_r_italic = Some(attr(&e, b"val").as_deref() != Some("0")),
                b"sz" if in_rpr => current_r_size = attr(&e, b"val").and_then(|v| v.parse::<f32>().ok()).map(|h| h / 2.0),
                b"t" => in_t = true,
                b"instrText" => in_instr = true,
                _ => {}
            },
            Ok(Event::Text(t)) => {
                if in_t {
                    if let Ok(s) = t.unescape() {
                        run.text.push_str(&s);
                    }
                } else if in_instr {
                    if let Ok(s) = t.unescape() {
                        instr_text.push_str(&s);
                    }
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"t" => in_t = false,
                b"pPr" => in_ppr = false,
                b"rPr" => in_rpr = false,
                b"instrText" => {
                    in_instr = false;
                    let upper = instr_text.trim().to_uppercase();
                    if upper.contains("NUMPAGES") {
                        active_field = Some(FieldType::NumPages);
                    } else if upper.contains("PAGE") {
                        active_field = Some(FieldType::Page);
                    }
                    instr_text.clear();
                }
                b"fldSimple" => {
                    if let Some(field) = active_field.take() {
                        if para.runs.last().map_or(true, |r| r.field.is_none()) {
                            para.runs.push(Run {
                                text: String::new(),
                                bold: false,
                                italic: false,
                                size_pt: Some(9.0),
                                field: Some(field),
                            });
                        }
                    }
                }
                b"r" => {
                    let resolved_para = styles.resolve_para(current_p_style_id.as_deref());
                    let resolved_run = styles.resolve_run(current_r_style_id.as_deref(), &resolved_para);
                    run.bold = current_r_bold.or(resolved_run.bold).unwrap_or(false);
                    run.italic = current_r_italic.or(resolved_run.italic).unwrap_or(false);
                    run.size_pt = current_r_size.or(resolved_run.size_pt).or(Some(9.0));
                    if let Some(field) = active_field {
                        run.field = Some(field);
                    }
                    para.runs.push(std::mem::take(&mut run));
                }
                b"p" => {
                    let resolved_para = styles.resolve_para(current_p_style_id.as_deref());
                    para.align = current_p_align.or(resolved_para.align).unwrap_or(Align::Left);
                    hf.paras.push(std::mem::take(&mut para));
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            _ => {}
        }
    }
    hf
}

pub fn parse(bytes: &[u8]) -> Result<Doc, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;

    let styles = if let Ok(mut sf) = zip.by_name("word/styles.xml") {
        let mut sxml = String::new();
        if sf.read_to_string(&mut sxml).is_ok() {
            parse_styles(&sxml)
        } else {
            Styles::default()
        }
    } else {
        Styles::default()
    };

    let mut numbering = if let Ok(mut nf) = zip.by_name("word/numbering.xml") {
        let mut nxml = String::new();
        if nf.read_to_string(&mut nxml).is_ok() {
            parse_numbering(&nxml)
        } else {
            Numbering::default()
        }
    } else {
        Numbering::default()
    };

    let mut doc = Doc {
        blocks: vec![],
        images: HashMap::new(),
        header: None,
        footer: None,
        page: Page::default(),
        warnings: vec![],
    };

    // Parse relationships for images, headers, footers
    let mut rel_paths = HashMap::new();
    let mut header_paths = HashMap::new();
    let mut footer_paths = HashMap::new();
    if let Ok(mut rf) = zip.by_name("word/_rels/document.xml.rels") {
        let mut rxml = String::new();
        if rf.read_to_string(&mut rxml).is_ok() {
            let mut r = Reader::from_str(&rxml);
            loop {
                match r.read_event() {
                    Ok(Event::Start(e)) | Ok(Event::Empty(e)) if e.local_name().as_ref() == b"Relationship" => {
                        let id = attr(&e, b"Id");
                        let target = attr(&e, b"Target");
                        let rtype = attr(&e, b"Type");
                        if let (Some(id), Some(target), Some(rtype)) = (id, target, rtype) {
                            let clean_target = target.trim_start_matches('/').to_string();
                            let full_path = if clean_target.starts_with("word/") {
                                clean_target
                            } else {
                                format!("word/{}", clean_target)
                            };
                            if rtype.contains("image") {
                                rel_paths.insert(id, full_path);
                            } else if rtype.contains("header") {
                                header_paths.insert(id, full_path);
                            } else if rtype.contains("footer") {
                                footer_paths.insert(id, full_path);
                            }
                        }
                    }
                    Ok(Event::Eof) => break,
                    _ => {}
                }
            }
        }
    }

    // Load image bytes from zip
    for (rel_id, full_path) in rel_paths {
        if let Ok(mut mf) = zip.by_name(&full_path) {
            let mut img_bytes = Vec::new();
            if mf.read_to_end(&mut img_bytes).is_ok() {
                if let Some((w, h)) = parse_jpeg(&img_bytes) {
                    doc.images.insert(rel_id, ImageData {
                        bytes: img_bytes,
                        width: w,
                        height: h,
                        is_jpeg: true,
                        smask_bytes: None,
                    });
                } else if let Some((w, h, rgb, smask)) = parse_png(&img_bytes) {
                    doc.images.insert(rel_id, ImageData {
                        bytes: rgb,
                        width: w,
                        height: h,
                        is_jpeg: false,
                        smask_bytes: smask,
                    });
                }
            }
        }
    }

    let mut xml = String::new();
    zip.by_name("word/document.xml").map_err(|e| e.to_string())?
        .read_to_string(&mut xml).map_err(|e| e.to_string())?;

    let mut r = Reader::from_str(&xml);

    let mut current_p_style_id: Option<String> = None;
    let mut current_p_align: Option<Align> = None;
    let mut current_p_space_before: Option<f32> = None;
    let mut current_p_space_after: Option<f32> = None;
    let mut current_p_line_mult: Option<f32> = None;
    let mut current_p_num_id: Option<String> = None;
    let mut current_p_ilvl: usize = 0;
    let mut current_p_ind_left: Option<f32> = None;
    let mut current_p_ind_hanging: Option<f32> = None;

    let mut current_r_style_id: Option<String> = None;
    let mut current_r_bold: Option<bool> = None;
    let mut current_r_italic: Option<bool> = None;
    let mut current_r_size: Option<f32> = None;

    let mut header_rel_id: Option<String> = None;
    let mut footer_rel_id: Option<String> = None;

    let (mut para, mut run) = (Para::default(), Run::default());
    let (mut cur_tbl, mut cur_tr, mut cur_tc) = (Table::default(), TableRow::default(), TableCell::default());
    let (mut in_t, mut in_run, mut in_ppr, mut in_rpr, mut in_numpr) = (false, false, false, false, false);
    let (mut in_tbl, mut in_tblpr, mut in_tr, mut in_tc, mut in_tcpr) = (false, false, false, false, false);
    let (mut in_drawing, mut cur_drawing_rel_id, mut cur_drawing_cx, mut cur_drawing_cy) = (false, None, None, None);

    loop {
        match r.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                match e.local_name().as_ref() {
                    b"tbl" => {
                        in_tbl = true;
                        cur_tbl = Table::default();
                    }
                    b"tblPr" if in_tbl => in_tblpr = true,
                    b"jc" if in_tblpr => {
                        cur_tbl.align = match attr(&e, b"val").as_deref() {
                            Some("center") => Align::Center,
                            Some("right") | Some("end") => Align::Right,
                            _ => Align::Left,
                        };
                    }
                    b"gridCol" if in_tbl => {
                        if let Some(w) = attr(&e, b"w").and_then(|v| v.parse::<f32>().ok()) {
                            cur_tbl.col_widths_pt.push(w / 20.0);
                        }
                    }
                    b"tr" if in_tbl => {
                        in_tr = true;
                        cur_tr = TableRow::default();
                    }
                    b"trHeight" if in_tr => {
                        if let Some(h) = attr(&e, b"val").and_then(|v| v.parse::<f32>().ok()) {
                            cur_tr.height_pt = Some(h / 20.0);
                        }
                    }
                    b"tc" if in_tr => {
                        in_tc = true;
                        cur_tc = TableCell::default();
                    }
                    b"tcPr" if in_tc => in_tcpr = true,
                    b"tcW" if in_tcpr => {
                        if let Some(w) = attr(&e, b"w").and_then(|v| v.parse::<f32>().ok()) {
                            cur_tc.width_pt = w / 20.0;
                        }
                    }
                    b"shd" if in_tcpr => {
                        if let Some(fill) = attr(&e, b"fill") {
                            cur_tc.bg_color = parse_hex_color(&fill);
                        }
                    }
                    b"p" => {
                        para = Para::default();
                        current_p_style_id = None;
                        current_p_align = None;
                        current_p_space_before = None;
                        current_p_space_after = None;
                        current_p_line_mult = None;
                        current_p_num_id = None;
                        current_p_ilvl = 0;
                        current_p_ind_left = None;
                        current_p_ind_hanging = None;
                    }
                    b"pPr" => in_ppr = true,
                    b"pStyle" if in_ppr => current_p_style_id = attr(&e, b"val"),
                    b"numPr" if in_ppr => in_numpr = true,
                    b"numId" if in_numpr => current_p_num_id = attr(&e, b"val"),
                    b"ilvl" if in_numpr => current_p_ilvl = attr(&e, b"val").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0),
                    b"ind" if in_ppr => {
                        let parse_pt = |k: &[u8]| attr(&e, k).and_then(|v| v.parse::<f32>().ok()).map(|v| v / 20.0);
                        if let Some(l) = parse_pt(b"left") { current_p_ind_left = Some(l); }
                        if let Some(h) = parse_pt(b"hanging") { current_p_ind_hanging = Some(h); }
                    }
                    b"jc" if in_ppr => current_p_align = match attr(&e, b"val").as_deref() {
                        Some("center") => Some(Align::Center),
                        Some("right") | Some("end") => Some(Align::Right),
                        _ => Some(Align::Left),
                    },
                    b"spacing" if in_ppr => {
                        let parse_pt = |k: &[u8]| attr(&e, k).and_then(|v| v.parse::<f32>().ok()).map(|v| v / 20.0);
                        if let Some(b) = parse_pt(b"before") { current_p_space_before = Some(b); }
                        if let Some(a) = parse_pt(b"after") { current_p_space_after = Some(a); }
                        if let Some(l) = attr(&e, b"line").and_then(|v| v.parse::<f32>().ok()).map(|v| v / 240.0) {
                            current_p_line_mult = Some(l);
                        }
                    }
                    b"r" => {
                        in_run = true;
                        run = Run::default();
                        current_r_style_id = None;
                        current_r_bold = None;
                        current_r_italic = None;
                        current_r_size = None;
                    }
                    b"rPr" => in_rpr = true,
                    b"rStyle" if in_rpr => current_r_style_id = attr(&e, b"val"),
                    b"b" if in_rpr => current_r_bold = Some(attr(&e, b"val").as_deref() != Some("0")),
                    b"i" if in_rpr => current_r_italic = Some(attr(&e, b"val").as_deref() != Some("0")),
                    b"sz" if in_rpr => current_r_size = attr(&e, b"val").and_then(|v| v.parse::<f32>().ok()).map(|h| h / 2.0),
                    b"t" => in_t = true,
                    b"pgSz" => {
                        if let Some(w) = attr(&e, b"w").and_then(|v| v.parse::<f32>().ok()) { doc.page.w_pt = w / 20.0; }
                        if let Some(h) = attr(&e, b"h").and_then(|v| v.parse::<f32>().ok()) { doc.page.h_pt = h / 20.0; }
                    }
                    b"pgMar" => {
                        let g = |k: &[u8]| attr(&e, k).and_then(|v| v.parse::<f32>().ok()).map(|v| v / 20.0);
                        if let Some(v) = g(b"left") { doc.page.ml = v; }
                        if let Some(v) = g(b"right") { doc.page.mr = v; }
                        if let Some(v) = g(b"top") { doc.page.mt = v; }
                        if let Some(v) = g(b"bottom") { doc.page.mb = v; }
                        if let Some(v) = g(b"header") { doc.page.header_margin_pt = v; }
                        if let Some(v) = g(b"footer") { doc.page.footer_margin_pt = v; }
                    }
                    b"headerReference" => {
                        let htype = attr(&e, b"type");
                        let r_id = attr(&e, b"id").or_else(|| attr(&e, b"Id"));
                        if htype.as_deref() == Some("default") || (htype.is_none() && header_rel_id.is_none()) {
                            header_rel_id = r_id;
                        }
                    }
                    b"footerReference" => {
                        let ftype = attr(&e, b"type");
                        let r_id = attr(&e, b"id").or_else(|| attr(&e, b"Id"));
                        if ftype.as_deref() == Some("default") || (ftype.is_none() && footer_rel_id.is_none()) {
                            footer_rel_id = r_id;
                        }
                    }
                    b"br" | b"tab" if in_run => run.text.push(' '),
                    b"drawing" | b"pict" => {
                        in_drawing = true;
                        cur_drawing_rel_id = None;
                        cur_drawing_cx = None;
                        cur_drawing_cy = None;
                    }
                    b"extent" if in_drawing => {
                        if let Some(cx) = attr(&e, b"cx").and_then(|v| v.parse::<f32>().ok()) { cur_drawing_cx = Some(cx / 12700.0); }
                        if let Some(cy) = attr(&e, b"cy").and_then(|v| v.parse::<f32>().ok()) { cur_drawing_cy = Some(cy / 12700.0); }
                    }
                    b"blip" | b"imagedata" if in_drawing => {
                        cur_drawing_rel_id = attr(&e, b"embed").or_else(|| attr(&e, b"id"));
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(t)) if in_t => run.text.push_str(&t.unescape().map_err(|e| e.to_string())?),
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"t" => in_t = false,
                b"pPr" => in_ppr = false,
                b"numPr" => in_numpr = false,
                b"rPr" => in_rpr = false,
                b"tblPr" => in_tblpr = false,
                b"tcPr" => in_tcpr = false,
                b"drawing" | b"pict" => {
                    in_drawing = false;
                    if let Some(rid) = cur_drawing_rel_id.take() {
                        let w = cur_drawing_cx.unwrap_or(0.0);
                        let h = cur_drawing_cy.unwrap_or(0.0);
                        let align = current_p_align.unwrap_or(Align::Left);
                        let sb = current_p_space_before.unwrap_or(0.0);
                        let sa = current_p_space_after.unwrap_or(8.0);
                        doc.blocks.push(Block::Image(ImageBlock {
                            rel_id: rid,
                            width_pt: w,
                            height_pt: h,
                            align,
                            space_before_pt: sb,
                            space_after_pt: sa,
                        }));
                    }
                }
                b"r" => {
                    in_run = false;
                    let resolved_para = styles.resolve_para(current_p_style_id.as_deref());
                    let resolved_run = styles.resolve_run(current_r_style_id.as_deref(), &resolved_para);
                    run.bold = current_r_bold.or(resolved_run.bold).unwrap_or(false);
                    run.italic = current_r_italic.or(resolved_run.italic).unwrap_or(false);
                    run.size_pt = current_r_size.or(resolved_run.size_pt);
                    para.runs.push(std::mem::take(&mut run));
                }
                b"p" => {
                    let resolved_para = styles.resolve_para(current_p_style_id.as_deref());
                    para.align = current_p_align.or(resolved_para.align).unwrap_or(Align::Left);
                    para.space_before_pt = current_p_space_before.or(resolved_para.space_before_pt).unwrap_or(0.0);
                    para.space_after_pt = current_p_space_after.or(resolved_para.space_after_pt).unwrap_or(8.0);
                    para.line_spacing_mult = current_p_line_mult.or(resolved_para.line_spacing_mult).unwrap_or(1.2);
                    if let Some(ref num_id) = current_p_num_id {
                        if let Some((marker, ind, hang)) = numbering.next_marker(num_id, current_p_ilvl) {
                            para.list_marker = Some(marker);
                            para.indent_left_pt = current_p_ind_left.unwrap_or(ind);
                            para.hanging_pt = current_p_ind_hanging.unwrap_or(hang);
                        }
                    }
                    if in_tc {
                        cur_tc.paras.push(std::mem::take(&mut para));
                    } else if !para.runs.is_empty() || cur_drawing_rel_id.is_none() {
                        doc.blocks.push(Block::Para(std::mem::take(&mut para)));
                    }
                }
                b"tc" => {
                    in_tc = false;
                    cur_tr.cells.push(std::mem::take(&mut cur_tc));
                }
                b"tr" => {
                    in_tr = false;
                    cur_tbl.rows.push(std::mem::take(&mut cur_tr));
                }
                b"tbl" => {
                    in_tbl = false;
                    doc.blocks.push(Block::Table(std::mem::take(&mut cur_tbl)));
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(e) => return Err(e.to_string()),
            _ => {}
        }
    }

    // Load Header if defined
    if let Some(hpath) = header_rel_id.as_ref().and_then(|id| header_paths.get(id)).or_else(|| header_paths.values().next()) {
        if let Ok(mut hf_file) = zip.by_name(hpath) {
            let mut hxml = String::new();
            if hf_file.read_to_string(&mut hxml).is_ok() {
                doc.header = Some(parse_header_footer(&hxml, &styles));
            }
        }
    }

    // Load Footer if defined
    if let Some(fpath) = footer_rel_id.as_ref().and_then(|id| footer_paths.get(id)).or_else(|| footer_paths.values().next()) {
        if let Ok(mut ff_file) = zip.by_name(fpath) {
            let mut fxml = String::new();
            if ff_file.read_to_string(&mut fxml).is_ok() {
                doc.footer = Some(parse_header_footer(&fxml, &styles));
            }
        }
    }

    doc.warnings.dedup();
    Ok(doc)
}
