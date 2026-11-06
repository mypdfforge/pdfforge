mod layout;
mod model;
mod parse;
mod pdf;
mod subset;

use wasm_bindgen::prelude::*;

#[derive(Default)]
pub struct FontData {
    pub regular: Option<Vec<u8>>,
    pub bold: Option<Vec<u8>>,
    pub italic: Option<Vec<u8>>,
    pub bold_italic: Option<Vec<u8>>,
    pub fallbacks: Vec<Vec<u8>>,
}

#[wasm_bindgen]
pub struct Converter {
    fonts: FontData,
}

#[wasm_bindgen]
impl Converter {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Converter {
        Converter {
            fonts: FontData::default(),
        }
    }

    /// Register font variants: 'regular' (or default), 'bold', 'italic', 'bold-italic'
    #[wasm_bindgen(js_name = registerFont)]
    pub fn register_font(&mut self, variant: &str, data: Vec<u8>) {
        let lower = variant.to_lowercase();
        if lower.contains("bold") && lower.contains("italic") {
            self.fonts.bold_italic = Some(data);
        } else if lower.contains("bold") {
            self.fonts.bold = Some(data);
        } else if lower.contains("italic") {
            self.fonts.italic = Some(data);
        } else {
            self.fonts.regular = Some(data);
        }
    }

    /// Register fallback font data for multi-lingual and non-Latin scripts
    #[wasm_bindgen(js_name = registerFallbackFont)]
    pub fn register_fallback_font(&mut self, data: Vec<u8>) {
        self.fonts.fallbacks.push(data);
    }

    /// Returns PDF bytes. Warnings via lastWarnings-style: joined by \n in the error-free path.
    pub fn convert(&self, docx: &[u8]) -> Result<Vec<u8>, JsValue> {
        let reg_bytes = self
            .fonts
            .regular
            .as_ref()
            .ok_or_else(|| JsValue::from_str("registerFont (regular/default) first"))?;
        let reg_face = ttf_parser::Face::parse(reg_bytes, 0)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let bold_face = self
            .fonts
            .bold
            .as_ref()
            .and_then(|b| ttf_parser::Face::parse(b, 0).ok());
        let italic_face = self
            .fonts
            .italic
            .as_ref()
            .and_then(|b| ttf_parser::Face::parse(b, 0).ok());
        let bi_face = self
            .fonts
            .bold_italic
            .as_ref()
            .and_then(|b| ttf_parser::Face::parse(b, 0).ok());

        let mut fb_faces = Vec::new();
        for b in &self.fonts.fallbacks {
            if let Ok(f) = ttf_parser::Face::parse(b, 0) {
                fb_faces.push(f);
            }
        }

        let faces = layout::FaceSet {
            regular: &reg_face,
            bold: bold_face.as_ref(),
            italic: italic_face.as_ref(),
            bold_italic: bi_face.as_ref(),
            fallbacks: &fb_faces,
        };

        let doc = parse::parse(docx).map_err(|e| JsValue::from_str(&e))?;
        let pages = layout::layout(&doc, &faces);

        let font_bytes_set = pdf::FontBytesSet {
            regular: reg_bytes,
            bold: self.fonts.bold.as_deref(),
            italic: self.fonts.italic.as_deref(),
            bold_italic: self.fonts.bold_italic.as_deref(),
            fallbacks: &self.fonts.fallbacks,
        };

        Ok(pdf::write(&pages, &doc.page, &doc, &font_bytes_set, &faces))
    }
}
