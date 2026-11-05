// Document model with styles cascade and lists/numbering support.
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FieldType {
    Page,
    NumPages,
}

#[derive(Clone, Default)]
pub struct Run {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub size_pt: Option<f32>,
    pub color: Option<[u8; 3]>,
    pub field: Option<FieldType>,
}

#[derive(Clone)]
pub struct Para {
    pub runs: Vec<Run>,
    pub align: Align,
    pub space_before_pt: f32,
    pub space_after_pt: f32,
    pub line_spacing_mult: f32,
    pub list_marker: Option<String>,
    pub indent_left_pt: f32,
    pub hanging_pt: f32,
}

impl Default for Para {
    fn default() -> Self {
        Para {
            runs: vec![],
            align: Align::Left,
            space_before_pt: 0.0,
            space_after_pt: 8.0,
            line_spacing_mult: 1.2,
            list_marker: None,
            indent_left_pt: 0.0,
            hanging_pt: 0.0,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum NumFmt {
    #[default]
    Decimal,
    Bullet,
    LowerLetter,
    UpperLetter,
    LowerRoman,
    UpperRoman,
}

#[derive(Clone, Debug)]
pub struct ListLevel {
    pub start: usize,
    pub format: NumFmt,
    pub lvl_text: String,
    pub indent_pt: f32,
    pub hanging_pt: f32,
}

impl Default for ListLevel {
    fn default() -> Self {
        ListLevel {
            start: 1,
            format: NumFmt::Decimal,
            lvl_text: "%1.".into(),
            indent_pt: 36.0,
            hanging_pt: 18.0,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct AbstractNum {
    pub id: String,
    pub levels: HashMap<usize, ListLevel>,
}

#[derive(Default)]
pub struct Numbering {
    pub abstract_nums: HashMap<String, AbstractNum>,
    pub num_to_abstract: HashMap<String, String>,
    pub counters: HashMap<String, HashMap<usize, usize>>,
}

fn format_roman(mut n: usize, upper: bool) -> String {
    let vals = [
        (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
        (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
        (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")
    ];
    let mut res = String::new();
    for &(val, sym) in &vals {
        while n >= val {
            res.push_str(sym);
            n -= val;
        }
    }
    if upper { res } else { res.to_lowercase() }
}

fn format_letter(mut n: usize, upper: bool) -> String {
    if n == 0 { n = 1; }
    let mut res = String::new();
    while n > 0 {
        n -= 1;
        let c = ((n % 26) as u8 + if upper { b'A' } else { b'a' }) as char;
        res.insert(0, c);
        n /= 26;
    }
    res
}

impl Numbering {
    pub fn next_marker(&mut self, num_id: &str, ilvl: usize) -> Option<(String, f32, f32)> {
        let abs_id = self.num_to_abstract.get(num_id)?;
        let abs_num = self.abstract_nums.get(abs_id)?;
        let level = abs_num.levels.get(&ilvl)?;

        let num_counters = self.counters.entry(num_id.to_string()).or_default();
        let count = num_counters.entry(ilvl).or_insert(level.start.saturating_sub(1));
        *count += 1;
        let current_count = *count;

        // Reset child levels if any
        num_counters.retain(|&k, _| k <= ilvl);

        let formatted = match level.format {
            NumFmt::Bullet => {
                let sym = level.lvl_text.trim();
                if sym.is_empty() || sym.chars().any(|c| (c as u32) >= 0xF000) {
                    "•".to_string()
                } else {
                    sym.to_string()
                }
            }
            NumFmt::Decimal => current_count.to_string(),
            NumFmt::LowerLetter => format_letter(current_count, false),
            NumFmt::UpperLetter => format_letter(current_count, true),
            NumFmt::LowerRoman => format_roman(current_count, false),
            NumFmt::UpperRoman => format_roman(current_count, true),
        };

        let placeholder = format!("%{}", ilvl + 1);
        let marker = if level.format == NumFmt::Bullet {
            format!("{} ", formatted)
        } else if level.lvl_text.contains(&placeholder) {
            format!("{} ", level.lvl_text.replace(&placeholder, &formatted))
        } else {
            format!("{}. ", formatted)
        };

        Some((marker, level.indent_pt, level.hanging_pt))
    }
}

#[derive(Clone, Copy, Default, PartialEq)]
pub enum Align {
    #[default]
    Left,
    Center,
    Right,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub enum StyleType {
    #[default]
    Paragraph,
    Character,
}

#[derive(Clone, Default)]
pub struct Style {
    pub style_id: String,
    pub style_type: StyleType,
    pub based_on: Option<String>,
    pub align: Option<Align>,
    pub space_before_pt: Option<f32>,
    pub space_after_pt: Option<f32>,
    pub line_spacing_mult: Option<f32>,
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub size_pt: Option<f32>,
    pub color: Option<[u8; 3]>,
}

impl Style {
    pub fn merge(&mut self, other: &Style) {
        if let Some(a) = other.align { self.align = Some(a); }
        if let Some(sb) = other.space_before_pt { self.space_before_pt = Some(sb); }
        if let Some(sa) = other.space_after_pt { self.space_after_pt = Some(sa); }
        if let Some(ls) = other.line_spacing_mult { self.line_spacing_mult = Some(ls); }
        if let Some(b) = other.bold { self.bold = Some(b); }
        if let Some(i) = other.italic { self.italic = Some(i); }
        if let Some(sz) = other.size_pt { self.size_pt = Some(sz); }
        if let Some(c) = other.color { self.color = Some(c); }
    }
}

#[derive(Default)]
pub struct Styles {
    pub default_style: Style,
    pub styles: HashMap<String, Style>,
}

impl Styles {
    pub fn resolve_para(&self, style_id: Option<&str>) -> Style {
        let mut resolved = self.default_style.clone();
        if let Some(id) = style_id {
            for s in self.inheritance_chain(id) {
                resolved.merge(&s);
            }
        }
        resolved
    }

    pub fn resolve_run(&self, char_style_id: Option<&str>, base_style: &Style) -> Style {
        let mut resolved = base_style.clone();
        if let Some(id) = char_style_id {
            for s in self.inheritance_chain(id) {
                resolved.merge(&s);
            }
        }
        resolved
    }

    fn inheritance_chain(&self, id: &str) -> Vec<Style> {
        let mut chain = Vec::new();
        let mut cur = Some(id.to_string());
        let mut visited = HashSet::new();
        while let Some(sid) = cur {
            if !visited.insert(sid.clone()) { break; }
            if let Some(st) = self.styles.get(&sid) {
                cur = st.based_on.clone();
                chain.push(st.clone());
            } else {
                break;
            }
        }
        chain.reverse();
        chain
    }
}

pub struct Page {
    pub w_pt: f32,
    pub h_pt: f32,
    pub ml: f32,
    pub mr: f32,
    pub mt: f32,
    pub mb: f32,
    pub header_margin_pt: f32,
    pub footer_margin_pt: f32,
}

impl Default for Page {
    fn default() -> Self {
        Page {
            w_pt: 595.0,
            h_pt: 842.0,
            ml: 72.0,
            mr: 72.0,
            mt: 72.0,
            mb: 72.0,
            header_margin_pt: 36.0,
            footer_margin_pt: 36.0,
        }
    }
}

#[derive(Clone, Default)]
pub struct HeaderFooter {
    pub paras: Vec<Para>,
}

#[derive(Clone)]
pub struct TableCell {
    pub paras: Vec<Para>,
    pub width_pt: f32,
    pub bg_color: Option<[u8; 3]>,
    pub border_left: bool,
    pub border_right: bool,
    pub border_top: bool,
    pub border_bottom: bool,
    pub border_color: [u8; 3],
    pub border_width_pt: f32,
    pub pad_left_pt: f32,
    pub pad_right_pt: f32,
    pub pad_top_pt: f32,
    pub pad_bottom_pt: f32,
}

impl Default for TableCell {
    fn default() -> Self {
        TableCell {
            paras: vec![],
            width_pt: 0.0,
            bg_color: None,
            border_left: true,
            border_right: true,
            border_top: true,
            border_bottom: true,
            border_color: [200, 200, 200],
            border_width_pt: 0.75,
            pad_left_pt: 5.4,
            pad_right_pt: 5.4,
            pad_top_pt: 3.0,
            pad_bottom_pt: 3.0,
        }
    }
}

#[derive(Clone, Default)]
pub struct TableRow {
    pub cells: Vec<TableCell>,
    pub height_pt: Option<f32>,
}

#[derive(Clone, Default)]
pub struct Table {
    pub rows: Vec<TableRow>,
    pub col_widths_pt: Vec<f32>,
    pub align: Align,
    pub space_before_pt: f32,
    pub space_after_pt: f32,
}

#[derive(Clone)]
pub struct ImageBlock {
    pub rel_id: String,
    pub width_pt: f32,
    pub height_pt: f32,
    pub align: Align,
    pub space_before_pt: f32,
    pub space_after_pt: f32,
}

#[derive(Clone)]
pub struct ImageData {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub is_jpeg: bool,
    pub smask_bytes: Option<Vec<u8>>,
}

#[derive(Clone)]
pub enum Block {
    Para(Para),
    Table(Table),
    Image(ImageBlock),
}

pub struct Doc {
    pub blocks: Vec<Block>,
    pub images: HashMap<String, ImageData>,
    pub header: Option<HeaderFooter>,
    pub footer: Option<HeaderFooter>,
    pub page: Page,
    pub warnings: Vec<String>,
}
