# docx2pdf (Phase 1 skeleton)
Build: `rustup target add wasm32-unknown-unknown && cargo install wasm-pack && wasm-pack build --release --target web --out-dir www/pkg`
Then serve `www/` (`python3 -m http.server`) and open index.html.
Phase 1 does: paragraphs, runs, align, page size/margins, line wrap, pages, selectable text.
Not yet: styles.xml, bold/italic fonts, tables, images, lists, headers/footers, subsetting.
STATUS: written without compiler access. Never built. Expect small API fixes.
