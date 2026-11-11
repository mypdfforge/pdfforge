/**
 * documentAst.js — Universal Intermediate Abstract Syntax Tree (AST)
 * Format-agnostic document model decoupling PDF extraction from Word (.docx),
 * Excel (.xlsx), and PowerPoint (.pptx) emitters.
 */

export const NodeType = Object.freeze({
  DOCUMENT: 'DOCUMENT',
  PAGE: 'PAGE',
  SECTION: 'SECTION',
  PARAGRAPH: 'PARAGRAPH',
  TEXT_RUN: 'TEXT_RUN',
  TABLE: 'TABLE',
  TABLE_ROW: 'TABLE_ROW',
  TABLE_CELL: 'TABLE_CELL',
  CALLOUT: 'CALLOUT',
  CODE_BLOCK: 'CODE_BLOCK',
  SHAPE: 'SHAPE',
});

/**
 * Creates a top-level Document root node.
 */
export function createDocument(metadata = {}) {
  return {
    type: NodeType.DOCUMENT,
    title: metadata.title || '',
    author: metadata.author || '',
    creator: metadata.creator || 'PDFForge Universal WASM Engine',
    createdAt: new Date().toISOString(),
    pages: [],
  };
}

/**
 * Creates a Page node.
 */
export function createPage(pageNumber, dimensions = {}, margins = {}) {
  return {
    type: NodeType.PAGE,
    pageNumber,
    width: dimensions.width || 595.28, // A4 default pt
    height: dimensions.height || 841.89,
    orientation: (dimensions.width || 595.28) > (dimensions.height || 841.89) ? 'landscape' : 'portrait',
    margins: {
      top: margins.top ?? 54,
      bottom: margins.bottom ?? 54,
      left: margins.left ?? 54,
      right: margins.right ?? 54,
    },
    header: null,
    footer: null,
    children: [], // Paragraphs, Tables, Callouts, Shapes
  };
}

/**
 * Creates a Paragraph node.
 */
export function createParagraph(options = {}) {
  return {
    type: NodeType.PARAGRAPH,
    headingLevel: options.headingLevel || null, // 1 to 6 or null for body
    align: options.align || 'left', // left, right, center, justify
    listLevel: options.listLevel ?? null, // 0 to 7
    listType: options.listType || null, // bullet, decimal, etc.
    lineSpacing: options.lineSpacing || 1.15,
    isTwoColumn: Boolean(options.isTwoColumn),
    columnIndex: options.columnIndex ?? null,
    bbox: options.bbox || null,
    runs: [],
  };
}

/**
 * Creates a TextRun node.
 */
export function createTextRun(options = {}) {
  return {
    type: NodeType.TEXT_RUN,
    text: options.text || '',
    font: options.font || undefined,
    size: options.size || 11, // in pt
    bold: Boolean(options.bold),
    italic: Boolean(options.italic),
    underline: Boolean(options.underline),
    strike: Boolean(options.strike),
    color: options.color || null, // Hex without '#'
    superScript: Boolean(options.superScript),
    subScript: Boolean(options.subScript),
    isRTL: Boolean(options.isRTL),
    script: options.script || 'latin',
  };
}

/**
 * Creates a Table node.
 */
export function createTable(options = {}) {
  return {
    type: NodeType.TABLE,
    numCols: options.numCols || 1,
    colWidths: options.colWidths || [], // percentage or points
    theme: {
      headerBg: options.theme?.bg || '1D283B',
      headerText: options.theme?.text || 'FFFFFF',
      border: options.theme?.border || '0F172A',
      zebraBg: options.theme?.zebraBg || null,
    },
    bbox: options.bbox || null,
    rows: [],
  };
}

/**
 * Creates a TableRow node.
 */
export function createTableRow(options = {}) {
  return {
    type: NodeType.TABLE_ROW,
    isHeader: Boolean(options.isHeader),
    isMergedHeader: Boolean(options.isMergedHeader),
    height: options.height || null,
    cells: [],
  };
}

/**
 * Creates a TableCell node with explicit numerical and accounting support for Excel.
 */
export function createTableCell(options = {}) {
  return {
    type: NodeType.TABLE_CELL,
    text: options.text || '',
    runs: options.runs || [],
    colSpan: options.colSpan || 1,
    rowSpan: options.rowSpan || 1,
    align: options.align || 'left',
    isHeader: Boolean(options.isHeader),
    bold: Boolean(options.bold),
    fontSize: options.fontSize || 10,
    bg: options.bg || null,
    border: options.border || null,
    // Numerical metadata for Excel (.xlsx) emitter
    isNumeric: Boolean(options.isNumeric),
    rawValue: options.rawValue !== undefined ? options.rawValue : null,
    formatCode: options.formatCode || null, // e.g. "$#,##0.00"
  };
}

/**
 * Creates a Callout / Admonition node.
 */
export function createCallout(options = {}) {
  return {
    type: NodeType.CALLOUT,
    calloutType: options.calloutType || 'info', // info, warning, tip, danger
    title: options.title || '',
    icon: options.icon || null,
    bg: options.bg || 'F8FAFC',
    border: options.border || '3B82F6',
    bbox: options.bbox || null,
    children: [], // Paragraphs or TextRuns
  };
}

/**
 * Creates a CodeBlock node.
 */
export function createCodeBlock(options = {}) {
  return {
    type: NodeType.CODE_BLOCK,
    language: options.language || 'text',
    lines: options.lines || [],
    font: options.font || 'Consolas',
    bg: options.bg || 'F1F5F9',
    border: options.border || 'E2E8F0',
    bbox: options.bbox || null,
  };
}

/**
 * Creates a 2D Vector Shape node for PowerPoint (.pptx) slide placement.
 */
export function createShape(options = {}) {
  return {
    type: NodeType.SHAPE,
    shapeType: options.shapeType || 'rectangle', // rectangle, line, circle
    x: options.x || 0,
    y: options.y || 0,
    w: options.w || 0,
    h: options.h || 0,
    fill: options.fill || null,
    stroke: options.stroke || null,
    lineWidth: options.lineWidth || 1,
  };
}

/**
 * Traverses an AST tree applying visitor callbacks per node type.
 */
export function walkAst(node, visitor = {}) {
  if (!node || typeof node !== 'object') return;

  const fn = visitor[node.type] || visitor['default'];
  if (typeof fn === 'function') {
    fn(node);
  }

  if (node.pages && Array.isArray(node.pages)) {
    for (const page of node.pages) walkAst(page, visitor);
  }
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) walkAst(child, visitor);
  }
  if (node.rows && Array.isArray(node.rows)) {
    for (const row of node.rows) walkAst(row, visitor);
  }
  if (node.cells && Array.isArray(node.cells)) {
    for (const cell of node.cells) walkAst(cell, visitor);
  }
  if (node.runs && Array.isArray(node.runs)) {
    for (const run of node.runs) walkAst(run, visitor);
  }
}

/**
 * Queries all tables in the AST — primary extractor for Excel (.xlsx).
 */
export function extractTablesFromAst(ast) {
  const tables = [];
  walkAst(ast, {
    [NodeType.TABLE]: (tbl) => tables.push(tbl),
  });
  return tables;
}

/**
 * Serializes the AST to a clean, JSON-compatible object.
 */
export function serializeAst(ast) {
  return JSON.parse(JSON.stringify(ast));
}
