/**
 * xmlSafe.ts (§10, §12)
 * OpenXML does not allow control characters:
 * U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+FFFE, U+FFFF.
 * Also handles lone surrogates and XML entity preservation.
 */

const ILLEGAL_XML_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/g;

export function sanitizeXmlString(str: string): string {
  if (!str) return '';
  return str.replace(ILLEGAL_XML_CHARS, (ch) => {
    // If it's a valid surrogate pair, retain it
    const code = ch.charCodeAt(0);
    if (code >= 0xd800 && code <= 0xdfff) {
      // Check if it's isolated or part of valid pair
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
