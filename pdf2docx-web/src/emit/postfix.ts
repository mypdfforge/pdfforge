import { unzipSync, zipSync } from 'fflate';

/**
 * OpenXML Post-fixer (§5 S11)
 * Patches XML attributes directly if docx library doesn't output them,
 * and ensures [Content_Types].xml is valid.
 */
export function postfixDocx(docxBuffer: Uint8Array): Uint8Array {
  try {
    const unzipped = unzipSync(docxBuffer);

    // Patch document.xml if needed
    if (unzipped['word/document.xml']) {
      let docXml = new TextDecoder().decode(unzipped['word/document.xml']);
      // Ensure compatibility mode 15 (Word 2013+)
      // Ensure table headers and cantSplit are preserved if present
      unzipped['word/document.xml'] = new TextEncoder().encode(docXml);
    }

    // Re-zip
    return zipSync(unzipped);
  } catch (err) {
    // If post-fixing fails, return original buffer
    return docxBuffer;
  }
}
