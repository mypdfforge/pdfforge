/**
 * xmlSafe.ts (§10, §12)
 * OpenXML does not allow control characters:
 * U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+FFFE, U+FFFF.
 * Also handles lone surrogates, HTML tag leakage, and Markdown artifact cleanup.
 */

const ILLEGAL_XML_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/g;

// Leaked HTML tags (P0 bug in audit report)
const HTML_TAG_REGEX = /<\/?(table|thead|tbody|tfoot|tr|th|td|caption|span|div|p|u|b|i|strong|em|s|strike|a)(?:\s+[^>]*)?\/?>/gi;

// Leaked Markdown artifacts (P0 bug in audit report)
const MARKDOWN_HEADER_REGEX = /^##+\s*/;
const MARKDOWN_STRAY_SYMBOLS = /[\*_~]{2,}|_~~/g;

export function sanitizeXmlString(str: string): string {
  if (!str) return '';

  // 1. Strip leaked HTML tags
  let cleaned = str.replace(HTML_TAG_REGEX, '');

  // 2. Strip leaked markdown headers and stray symbols
  cleaned = cleaned.replace(MARKDOWN_HEADER_REGEX, '');
  cleaned = cleaned.replace(MARKDOWN_STRAY_SYMBOLS, '');

  // 3. Remove illegal XML control characters while preserving valid surrogates and Unicode
  return cleaned.replace(ILLEGAL_XML_CHARS, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0xd800 && code <= 0xdfff) {
      return '';
    }
    return '';
  });
}

export function escapeXmlEntities(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
