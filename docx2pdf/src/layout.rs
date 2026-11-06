// Greedy line breaking + pagination. Uses real glyph advances, font variants, lists, and tables.
use crate::model::*;

#[derive(Clone, Debug)]
pub struct Span {
    pub x: f32,
    pub y_offset: f32,
    pub text: String,
    pub size: f32,
    pub bold: bool,
    pub italic: bool,
    pub width: f32,
    pub color: [u8; 3],
    pub underline: bool,
    pub strikethrough: bool,
    pub monospace: bool,
}

pub struct Line {
    pub y: f32,
    pub height: f32,
    pub spans: Vec<Span>,
}

#[derive(Clone, Debug)]
pub struct DrawRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub fill_color: Option<[u8; 3]>,
    pub stroke_color: Option<[u8; 3]>,
    pub stroke_width: f32,
}

#[derive(Clone, Debug)]
pub struct DrawLine {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
    pub color: [u8; 3],
    pub width: f32,
}

#[derive(Clone, Debug)]
pub struct DrawImage {
    pub rel_id: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

pub struct LPage {
    pub rects: Vec<DrawRect>,
    pub lines_vector: Vec<DrawLine>,
    pub images: Vec<DrawImage>,
    pub lines: Vec<Line>,
}

impl LPage {
    pub fn new() -> Self {
        LPage {
            rects: vec![],
            lines_vector: vec![],
            images: vec![],
            lines: vec![],
        }
    }
}

pub struct FaceSet<'a> {
    pub regular: &'a ttf_parser::Face<'a>,
    pub bold: Option<&'a ttf_parser::Face<'a>>,
    pub italic: Option<&'a ttf_parser::Face<'a>>,
    pub bold_italic: Option<&'a ttf_parser::Face<'a>>,
}

impl<'a> FaceSet<'a> {
    pub fn select(&self, bold: bool, italic: bool) -> &ttf_parser::Face<'a> {
        match (bold, italic) {
            (true, true) => self.bold_italic
                .or(self.bold)
                .or(self.italic)
                .unwrap_or(self.regular),
            (true, false) => self.bold.unwrap_or(self.regular),
            (false, true) => self.italic.unwrap_or(self.regular),
            (false, false) => self.regular,
        }
    }
}

pub fn is_symbol(c: char) -> bool {
    matches!(c, '✔' | '✓' | '✗' | '✕' | '☑' | '☐')
}

pub fn char_width(c: char, face: &ttf_parser::Face, size: f32) -> f32 {
    if is_symbol(c) {
        size * 0.75
    } else {
        let upm = face.units_per_em() as f32;
        face.glyph_index(c)
            .and_then(|g| face.glyph_hor_advance(g))
            .unwrap_or(0) as f32 * size / upm
    }
}

pub fn width(face: &ttf_parser::Face, s: &str, size: f32) -> f32 {
    token_width(face, s, size)
}

pub fn token_width(face: &ttf_parser::Face, s: &str, size: f32) -> f32 {
    s.chars().map(|c| char_width(c, face, size)).sum()
}

#[derive(Clone)]
struct Token {
    text: String,
    bold: bool,
    italic: bool,
    size: f32,
    y_offset: f32,
    color: [u8; 3],
    width: f32,
    is_space: bool,
    is_newline: bool,
    underline: bool,
    strikethrough: bool,
    monospace: bool,
}

fn break_para_into_lines(
    para: &Para,
    faces: &FaceSet,
    max_w: f32,
    page_num: Option<usize>,
    total_pages: Option<usize>,
) -> Vec<(Vec<Span>, f32, f32)> {
    let mut tokens: Vec<Token> = Vec::new();
    for r in &para.runs {
        let text_to_use = match r.field {
            Some(FieldType::Page) => page_num.map(|n| n.to_string()).unwrap_or_else(|| r.text.clone()),
            Some(FieldType::NumPages) => total_pages.map(|n| n.to_string()).unwrap_or_else(|| r.text.clone()),
            None => r.text.clone(),
        };
        if text_to_use.is_empty() { continue; }
        let raw_size = r.size_pt.unwrap_or(11.0);
        let (size, y_offset) = match r.vert_align {
            Some(VertAlign::Superscript) => ((raw_size * 0.65).max(6.0), raw_size * 0.35),
            Some(VertAlign::Subscript) => ((raw_size * 0.65).max(6.0), -raw_size * 0.15),
            _ => (raw_size, 0.0),
        };
        let color = r.color.unwrap_or([0, 0, 0]);
        let face = faces.select(r.bold, r.italic);
        let mut cur_token = String::new();
        let mut in_space = false;

        for ch in text_to_use.chars() {
            if ch == '\n' {
                if !cur_token.is_empty() {
                    let w = token_width(face, &cur_token, size);
                    tokens.push(Token {
                        text: std::mem::take(&mut cur_token),
                        bold: r.bold,
                        italic: r.italic,
                        size,
                        y_offset,
                        color,
                        width: w,
                        is_space: in_space,
                        is_newline: false,
                        underline: r.underline,
                        strikethrough: r.strikethrough,
                        monospace: r.monospace,
                    });
                }
                tokens.push(Token {
                    text: String::new(),
                    bold: r.bold,
                    italic: r.italic,
                    size,
                    y_offset,
                    color,
                    width: 0.0,
                    is_space: false,
                    is_newline: true,
                    underline: r.underline,
                    strikethrough: r.strikethrough,
                    monospace: r.monospace,
                });
                in_space = false;
                continue;
            }

            let ch_is_space = ch == ' ';
            if !cur_token.is_empty() && ch_is_space != in_space {
                let w = token_width(face, &cur_token, size);
                tokens.push(Token {
                    text: std::mem::take(&mut cur_token),
                    bold: r.bold,
                    italic: r.italic,
                    size,
                    y_offset,
                    color,
                    width: w,
                    is_space: in_space,
                    is_newline: false,
                    underline: r.underline,
                    strikethrough: r.strikethrough,
                    monospace: r.monospace,
                });
            }
            in_space = ch_is_space;
            cur_token.push(ch);
        }
        if !cur_token.is_empty() {
            let w = token_width(face, &cur_token, size);
            tokens.push(Token {
                text: cur_token,
                bold: r.bold,
                italic: r.italic,
                size,
                y_offset,
                color,
                width: w,
                is_space: in_space,
                is_newline: false,
                underline: r.underline,
                strikethrough: r.strikethrough,
                monospace: r.monospace,
            });
        }
    }

    let mut lines: Vec<Vec<Token>> = Vec::new();
    let mut current_line: Vec<Token> = Vec::new();
    let mut current_line_w: f32 = 0.0;

    for token in tokens {
        if token.is_newline {
            while let Some(last) = current_line.last() {
                if last.is_space { current_line.pop(); } else { break; }
            }
            lines.push(std::mem::take(&mut current_line));
            current_line_w = 0.0;
            continue;
        }

        if current_line.is_empty() {
            if token.is_space { continue; }
            if token.width <= max_w {
                current_line_w = token.width;
                current_line.push(token);
            } else {
                let face = faces.select(token.bold, token.italic);
                let mut chunk = String::new();
                let mut chunk_w = 0.0;
                for ch in token.text.chars() {
                    let cw = char_width(ch, face, token.size);
                    if chunk_w + cw > max_w && !chunk.is_empty() {
                        lines.push(vec![Token {
                            text: std::mem::take(&mut chunk),
                            width: chunk_w,
                            ..token.clone()
                        }]);
                        chunk_w = 0.0;
                    }
                    chunk.push(ch);
                    chunk_w += cw;
                }
                if !chunk.is_empty() {
                    current_line.push(Token {
                        text: chunk,
                        width: chunk_w,
                        ..token
                    });
                    current_line_w = chunk_w;
                }
            }
        } else if current_line_w + token.width <= max_w {
            current_line_w += token.width;
            current_line.push(token);
        } else {
            while let Some(last) = current_line.last() {
                if last.is_space { current_line.pop(); } else { break; }
            }
            if !current_line.is_empty() {
                lines.push(std::mem::take(&mut current_line));
            }
            current_line_w = 0.0;
            if !token.is_space {
                if token.width <= max_w {
                    current_line_w = token.width;
                    current_line.push(token);
                } else {
                    let face = faces.select(token.bold, token.italic);
                    let mut chunk = String::new();
                    let mut chunk_w = 0.0;
                    for ch in token.text.chars() {
                        let cw = char_width(ch, face, token.size);
                        if chunk_w + cw > max_w && !chunk.is_empty() {
                            lines.push(vec![Token {
                                text: std::mem::take(&mut chunk),
                                width: chunk_w,
                                ..token.clone()
                            }]);
                            chunk_w = 0.0;
                        }
                        chunk.push(ch);
                        chunk_w += cw;
                    }
                    if !chunk.is_empty() {
                        current_line.push(Token {
                            text: chunk,
                            width: chunk_w,
                            ..token
                        });
                        current_line_w = chunk_w;
                    }
                }
            }
        }
    }

    while let Some(last) = current_line.last() {
        if last.is_space { current_line.pop(); } else { break; }
    }
    if !current_line.is_empty() {
        lines.push(current_line);
    }

    let mut result = Vec::new();
    for line_tokens in lines {
        let mut spans: Vec<Span> = Vec::new();
        for t in line_tokens {
            if let Some(last) = spans.last_mut() {
                if last.bold == t.bold
                    && last.italic == t.italic
                    && (last.size - t.size).abs() < 0.001
                    && (last.y_offset - t.y_offset).abs() < 0.001
                    && last.color == t.color
                    && last.underline == t.underline
                    && last.strikethrough == t.strikethrough
                    && last.monospace == t.monospace
                {
                    last.text.push_str(&t.text);
                    last.width += t.width;
                    continue;
                }
            }
            spans.push(Span {
                x: 0.0,
                y_offset: t.y_offset,
                text: t.text,
                size: t.size,
                bold: t.bold,
                italic: t.italic,
                width: t.width,
                color: t.color,
                underline: t.underline,
                strikethrough: t.strikethrough,
                monospace: t.monospace,
            });
        }

        let max_size = spans.iter().map(|s| s.size).fold(11.0f32, f32::max);
        let lh = max_size * para.line_spacing_mult;
        result.push((spans, max_size, lh));
    }

    result
}

fn layout_single_para(
    para: &Para,
    p: &Page,
    faces: &FaceSet,
    pages: &mut Vec<LPage>,
    y: &mut f32,
) {
    if *y > p.mt && para.space_before_pt > 0.0 {
        *y += para.space_before_pt;
    }

    let is_list = para.list_marker.is_some();
    let indent_left = if is_list { para.indent_left_pt } else { 0.0 };
    let hanging = if is_list { para.hanging_pt } else { 0.0 };
    let max_w = (p.w_pt - p.ml - p.mr - indent_left).max(50.0);

    let lines = break_para_into_lines(para, faces, max_w, None, None);

    if lines.is_empty() {
        if *y > p.mt {
            let empty_size = 11.0;
            let lh = empty_size * para.line_spacing_mult;
            if *y + lh > p.h_pt - p.mb {
                pages.push(LPage::new());
                *y = p.mt;
            } else {
                *y += lh + para.space_after_pt;
            }
        }
        return;
    }

    for (line_idx, (mut spans, max_size, lh)) in lines.into_iter().enumerate() {
        let text_total_w: f32 = spans.iter().map(|s| s.width).sum();

        if *y + lh > p.h_pt - p.mb {
            pages.push(LPage::new());
            *y = p.mt;
        }

        let base_x = if is_list {
            p.ml + indent_left
        } else {
            match para.align {
                Align::Left => p.ml,
                Align::Center => p.ml + (max_w - text_total_w).max(0.0) / 2.0,
                Align::Right => p.ml + (max_w - text_total_w).max(0.0),
            }
        };

        let mut cur_x = base_x;
        for s in &mut spans {
            s.x = cur_x;
            cur_x += s.width;
        }

        if line_idx == 0 && is_list {
            if let Some(marker_str) = &para.list_marker {
                let marker_w = width(faces.regular, marker_str, max_size);
                let marker_x = (p.ml + indent_left - hanging).max(p.ml);
                spans.insert(0, Span {
                    x: marker_x,
                    y_offset: 0.0,
                    text: marker_str.clone(),
                    size: max_size,
                    bold: false,
                    italic: false,
                    width: marker_w,
                    color: [0, 0, 0],
                    underline: false,
                    strikethrough: false,
                    monospace: false,
                });
            }
        }

        pages.last_mut().unwrap().lines.push(Line {
            y: p.h_pt - *y - max_size,
            height: lh,
            spans,
        });
        *y += lh;
    }
    *y += para.space_after_pt;
}

fn layout_table(
    table: &Table,
    p: &Page,
    faces: &FaceSet,
    pages: &mut Vec<LPage>,
    y: &mut f32,
) {
    if table.rows.is_empty() { return; }
    if *y > p.mt && table.space_before_pt > 0.0 {
        *y += table.space_before_pt;
    }

    let max_page_w = (p.w_pt - p.ml - p.mr).max(50.0);
    let num_cols = table.rows.iter().map(|r| r.cells.len()).max().unwrap_or(1).max(1);

    // Determine column widths
    let mut col_widths = table.col_widths_pt.clone();
    if col_widths.len() < num_cols {
        let mut max_cell_widths = vec![0.0f32; num_cols];
        for row in &table.rows {
            for (i, cell) in row.cells.iter().enumerate() {
                if i < num_cols && cell.width_pt > max_cell_widths[i] {
                    max_cell_widths[i] = cell.width_pt;
                }
            }
        }
        if max_cell_widths.iter().all(|&w| w > 0.0) {
            col_widths = max_cell_widths;
        } else {
            let default_w = max_page_w / (num_cols as f32);
            col_widths = vec![default_w; num_cols];
        }
    }

    // Scale col_widths if total width exceeds max_page_w
    let total_w: f32 = col_widths.iter().sum();
    if total_w > max_page_w && total_w > 0.0 {
        let factor = max_page_w / total_w;
        for w in &mut col_widths {
            *w *= factor;
        }
    }
    let table_w: f32 = col_widths.iter().sum();
    let start_x = match table.align {
        Align::Left => p.ml,
        Align::Center => p.ml + (max_page_w - table_w).max(0.0) / 2.0,
        Align::Right => p.ml + (max_page_w - table_w).max(0.0),
    };

    for row in &table.rows {
        struct CellLayout {
            paras_lines: Vec<Vec<(Vec<Span>, f32, f32)>>,
            height: f32,
        }

        let mut cell_layouts: Vec<CellLayout> = Vec::new();
        for (i, cell) in row.cells.iter().enumerate() {
            let cw = col_widths.get(i).copied().unwrap_or(100.0);
            let content_w = (cw - cell.pad_left_pt - cell.pad_right_pt).max(10.0);
            let mut paras_lines = Vec::new();
            let mut cell_content_h = 0.0;

            for para in &cell.paras {
                let lines = break_para_into_lines(para, faces, content_w, None, None);
                for (_, _, lh) in &lines {
                    cell_content_h += *lh;
                }
                paras_lines.push(lines);
                cell_content_h += para.space_after_pt;
            }
            let total_cell_h = cell_content_h + cell.pad_top_pt + cell.pad_bottom_pt;
            cell_layouts.push(CellLayout {
                paras_lines,
                height: total_cell_h,
            });
        }

        let max_cell_h = cell_layouts.iter().map(|cl| cl.height).fold(0.0f32, f32::max);
        let row_h = row.height_pt.unwrap_or(0.0).max(max_cell_h).max(18.0);

        if *y + row_h > p.h_pt - p.mb {
            pages.push(LPage::new());
            *y = p.mt;
        }

        let mut cell_x = start_x;
        for (i, cell) in row.cells.iter().enumerate() {
            let cw = col_widths.get(i).copied().unwrap_or(100.0);
            let cell_y_bottom = p.h_pt - *y - row_h;
            let cell_y_top = p.h_pt - *y;

            // 1. Shading (background)
            if let Some(bg) = cell.bg_color {
                pages.last_mut().unwrap().rects.push(DrawRect {
                    x: cell_x,
                    y: cell_y_bottom,
                    w: cw,
                    h: row_h,
                    fill_color: Some(bg),
                    stroke_color: None,
                    stroke_width: 0.0,
                });
            }

            // 2. Borders per edge (allows callouts with left accent only!)
            let x_left = cell_x;
            let x_right = cell_x + cw;
            let y_top = cell_y_top;
            let y_bottom = cell_y_bottom;

            if cell.border_left.enabled && cell.border_left.width_pt > 0.0 {
                pages.last_mut().unwrap().lines_vector.push(DrawLine {
                    x1: x_left, y1: y_bottom, x2: x_left, y2: y_top,
                    color: cell.border_left.color, width: cell.border_left.width_pt,
                });
            }
            if cell.border_right.enabled && cell.border_right.width_pt > 0.0 {
                pages.last_mut().unwrap().lines_vector.push(DrawLine {
                    x1: x_right, y1: y_bottom, x2: x_right, y2: y_top,
                    color: cell.border_right.color, width: cell.border_right.width_pt,
                });
            }
            if cell.border_top.enabled && cell.border_top.width_pt > 0.0 {
                pages.last_mut().unwrap().lines_vector.push(DrawLine {
                    x1: x_left, y1: y_top, x2: x_right, y2: y_top,
                    color: cell.border_top.color, width: cell.border_top.width_pt,
                });
            }
            if cell.border_bottom.enabled && cell.border_bottom.width_pt > 0.0 {
                pages.last_mut().unwrap().lines_vector.push(DrawLine {
                    x1: x_left, y1: y_bottom, x2: x_right, y2: y_bottom,
                    color: cell.border_bottom.color, width: cell.border_bottom.width_pt,
                });
            }

            // 3. Text lines
            if let Some(cl) = cell_layouts.get(i) {
                let mut line_cur_y = *y + cell.pad_top_pt;
                for (para_idx, lines) in cl.paras_lines.iter().enumerate() {
                    let para = &cell.paras[para_idx];
                    for (mut spans, max_size, lh) in lines.clone() {
                        let text_total_w: f32 = spans.iter().map(|s| s.width).sum();
                        let base_x = match para.align {
                            Align::Left => cell_x + cell.pad_left_pt,
                            Align::Center => cell_x + cell.pad_left_pt + (cw - cell.pad_left_pt - cell.pad_right_pt - text_total_w).max(0.0) / 2.0,
                            Align::Right => cell_x + cw - cell.pad_right_pt - text_total_w,
                        };
                        let mut cur_span_x = base_x;
                        for s in &mut spans {
                            s.x = cur_span_x;
                            cur_span_x += s.width;
                        }
                        pages.last_mut().unwrap().lines.push(Line {
                            y: p.h_pt - line_cur_y - max_size,
                            height: lh,
                            spans,
                        });
                        line_cur_y += lh;
                    }
                    line_cur_y += para.space_after_pt;
                }
            }

            cell_x += cw;
        }

        *y += row_h;
    }

    *y += table.space_after_pt.max(8.0);
}

fn layout_image(
    img: &ImageBlock,
    p: &Page,
    doc: &Doc,
    pages: &mut Vec<LPage>,
    y: &mut f32,
) {
    if *y > p.mt && img.space_before_pt > 0.0 {
        *y += img.space_before_pt;
    }

    let max_page_w = (p.w_pt - p.ml - p.mr).max(50.0);
    let mut w = img.width_pt;
    let mut h = img.height_pt;

    if w <= 0.0 || h <= 0.0 {
        if let Some(data) = doc.images.get(&img.rel_id) {
            w = data.width as f32 * 72.0 / 96.0;
            h = data.height as f32 * 72.0 / 96.0;
        } else {
            w = 100.0;
            h = 100.0;
        }
    }

    if w > max_page_w && w > 0.0 {
        let factor = max_page_w / w;
        w = max_page_w;
        h *= factor;
    }

    let x = match img.align {
        Align::Left => p.ml,
        Align::Center => p.ml + (max_page_w - w).max(0.0) / 2.0,
        Align::Right => p.ml + (max_page_w - w).max(0.0),
    };

    if *y + h > p.h_pt - p.mb {
        pages.push(LPage::new());
        *y = p.mt;
    }

    pages.last_mut().unwrap().images.push(DrawImage {
        rel_id: img.rel_id.clone(),
        x,
        y: p.h_pt - *y - h,
        w,
        h,
    });

    *y += h + img.space_after_pt.max(8.0);
}

pub fn layout(doc: &Doc, faces: &FaceSet) -> Vec<LPage> {
    let p = &doc.page;
    let mut pages = vec![LPage::new()];
    let mut y = p.mt;

    for block in &doc.blocks {
        match block {
            Block::PageBreak => {
                let is_empty = pages.last().map_or(true, |pg| {
                    pg.lines.is_empty() && pg.rects.is_empty() && pg.lines_vector.is_empty() && pg.images.is_empty()
                });
                if !is_empty {
                    pages.push(LPage::new());
                    y = p.mt;
                }
            }
            Block::Para(para) => {
                if para.page_break_before {
                    let is_empty = pages.last().map_or(true, |pg| {
                        pg.lines.is_empty() && pg.rects.is_empty() && pg.lines_vector.is_empty() && pg.images.is_empty()
                    });
                    if !is_empty {
                        pages.push(LPage::new());
                        y = p.mt;
                    }
                }
                layout_single_para(para, p, faces, &mut pages, &mut y);
            }
            Block::Table(table) => {
                layout_table(table, p, faces, &mut pages, &mut y);
            }
            Block::Image(img) => {
                layout_image(img, p, doc, &mut pages, &mut y);
            }
        }
    }

    // Render Headers and Footers on each page
    let total_pages = pages.len();
    for page_idx in 0..total_pages {
        let page_num = page_idx + 1;

        // Header
        if let Some(header) = &doc.header {
            let mut hy = p.header_margin_pt;
            let max_w = (p.w_pt - p.ml - p.mr).max(50.0);
            for para in &header.paras {
                let lines = break_para_into_lines(para, faces, max_w, Some(page_num), Some(total_pages));
                for (mut spans, max_size, lh) in lines {
                    let text_total_w: f32 = spans.iter().map(|s| s.width).sum();
                    let base_x = match para.align {
                        Align::Left => p.ml,
                        Align::Center => p.ml + (max_w - text_total_w).max(0.0) / 2.0,
                        Align::Right => p.ml + (max_w - text_total_w).max(0.0),
                    };
                    let mut cur_x = base_x;
                    for s in &mut spans {
                        s.x = cur_x;
                        cur_x += s.width;
                    }
                    pages[page_idx].lines.push(Line {
                        y: p.h_pt - hy - max_size,
                        height: lh,
                        spans,
                    });
                    hy += lh;
                }
            }
        }

        // Footer
        if let Some(footer) = &doc.footer {
            let fy = p.footer_margin_pt;
            let max_w = (p.w_pt - p.ml - p.mr).max(50.0);
            for para in &footer.paras {
                let lines = break_para_into_lines(para, faces, max_w, Some(page_num), Some(total_pages));
                for (mut spans, max_size, _lh) in lines {
                    let text_total_w: f32 = spans.iter().map(|s| s.width).sum();
                    let base_x = match para.align {
                        Align::Left => p.ml,
                        Align::Center => p.ml + (max_w - text_total_w).max(0.0) / 2.0,
                        Align::Right => p.ml + (max_w - text_total_w).max(0.0),
                    };
                    let mut cur_x = base_x;
                    for s in &mut spans {
                        s.x = cur_x;
                        cur_x += s.width;
                    }
                    pages[page_idx].lines.push(Line {
                        y: fy,
                        height: max_size,
                        spans,
                    });
                }
            }
        }
    }

    pages
}