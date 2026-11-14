import {
  Document,
  Paragraph,
  TextRun,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  WidthType,
  AlignmentType,
  VerticalAlign,
  BorderStyle,
  Packer,
  ExternalHyperlink,
  ImageRun,
  SectionType,
  PageOrientation,
  Header,
  Footer,
  PageNumber,
  HeadingLevel,
} from 'docx';
import { DocAST, Block, Para, Run, Table, ImageBlock, Borders, BorderDef } from '../core/ast.js';
import { ptToTwips, ptToHalfPoints } from '../core/units.js';
import { sanitizeXmlString } from './xmlSafe.js';
import { createNumberingConfig } from './numbering.js';

export async function emitDocxBuffer(
  ast: DocAST,
  binaryStore: Map<string, Uint8Array> = new Map()
): Promise<Uint8Array> {
  const sections = ast.sections.map((sect) => {
    const isLandscape = sect.page.orient === 'landscape';
    const children = sect.blocks
      .map((block) => emitBlock(block, binaryStore))
      .filter((el): el is Paragraph | DocxTable => el !== null);

    // Headers & Footers
    const headerChildren = (sect.header || [])
      .map((block) => emitBlock(block, binaryStore))
      .filter((el): el is Paragraph => el instanceof Paragraph);

    const footerChildren = (sect.footer || [])
      .map((block) => emitBlock(block, binaryStore))
      .filter((el): el is Paragraph => el instanceof Paragraph);

    return {
      properties: {
        page: {
          size: {
            width: ptToTwips(sect.page.w),
            height: ptToTwips(sect.page.h),
            orientation: isLandscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
          },
          margin: {
            top: ptToTwips(sect.margins.t),
            right: ptToTwips(sect.margins.r),
            bottom: ptToTwips(sect.margins.b),
            left: ptToTwips(sect.margins.l),
          },
        },
      },
      headers:
        headerChildren.length > 0
          ? {
              default: new Header({
                children: headerChildren,
              }),
            }
          : undefined,
      footers:
        footerChildren.length > 0
          ? {
              default: new Footer({
                children: footerChildren,
              }),
            }
          : undefined,
      children: children.length > 0 ? children : [new Paragraph('')],
    };
  });

  const doc = new Document({
    numbering: createNumberingConfig(),
    sections,
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}

function emitBlock(
  block: Block,
  binaryStore: Map<string, Uint8Array>
): Paragraph | DocxTable | null {
  if (block.type === 'p') {
    return emitParagraph(block as Para);
  } else if (block.type === 'tbl') {
    return emitTable(block as Table, binaryStore);
  } else if (block.type === 'img') {
    return emitImage(block as ImageBlock, binaryStore);
  }
  return null;
}

function isRtlText(str: string): boolean {
  return /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(str);
}

function emitParagraph(para: Para): Paragraph {
  const children = para.runs.map((r) => emitRun(r));
  const fullText = para.runs.map((r) => r.text).join('');
  const hasRtl = isRtlText(fullText);

  let alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT;
  if (para.align === 'center') alignment = AlignmentType.CENTER;
  else if (para.align === 'right' || hasRtl) alignment = AlignmentType.RIGHT;
  else if (para.align === 'justify') alignment = AlignmentType.BOTH;

  let heading: (typeof HeadingLevel)[keyof typeof HeadingLevel] | undefined;
  if (para.heading === 1) heading = HeadingLevel.HEADING_1;
  else if (para.heading === 2) heading = HeadingLevel.HEADING_2;
  else if (para.heading === 3) heading = HeadingLevel.HEADING_3;
  else if (para.heading === 4) heading = HeadingLevel.HEADING_4;

  const numbering = para.list
    ? {
        reference: para.list.kind === 'bullet' ? 'bullet-list' : 'number-list',
        level: Math.min(8, Math.max(0, para.list.level)),
      }
    : undefined;

  return new Paragraph({
    alignment,
    heading,
    numbering,
    bidirectional: hasRtl ? true : undefined,
    keepNext: para.keepNext,
    spacing: {
      before: para.spaceBefore ? ptToTwips(para.spaceBefore) : undefined,
      after: para.spaceAfter ? ptToTwips(para.spaceAfter) : undefined,
      line: para.lineSpacing ? Math.round(para.lineSpacing * 240) : undefined,
    },
    indent: para.indent
      ? {
          left: para.indent.left ? ptToTwips(para.indent.left) : undefined,
          firstLine: para.indent.first ? ptToTwips(para.indent.first) : undefined,
          right: para.indent.right ? ptToTwips(para.indent.right) : undefined,
        }
      : undefined,
    children,
  });
}

function emitRun(run: Run): TextRun | ExternalHyperlink {
  const text = sanitizeXmlString(run.text);
  // Explicit color: if heading run has no color, explicitly set Navy (#1E293B); otherwise default to #000000
  const color = run.color ? run.color.replace('#', '') : '000000';
  const size = Number.isFinite(run.size) && (run.size ?? 0) > 0 ? ptToHalfPoints(run.size!) : 22;
  const isRtl = isRtlText(text);

  // Script detection for font assignment
  const isCjk = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/.test(text);
  const isHindi = /[\u0900-\u097F]/.test(text);
  const isEmoji = /[\uD83C-\uD83E][\uDC00-\uDFFF]|[\u2600-\u27BF]/.test(text);

  const baseFont = run.font || 'Arial';
  let fontConfig: any = baseFont;

  if (isEmoji) {
    fontConfig = 'Segoe UI Emoji';
  } else if (isCjk) {
    fontConfig = 'SimSun';
  } else if (isHindi) {
    fontConfig = 'Nirmala UI';
  } else if (isRtl) {
    fontConfig = 'Arial';
  }

  // Support dynamic PAGE field
  if (text === 'PAGE') {
    return new TextRun({
      children: [PageNumber.CURRENT],
      font: fontConfig,
      size,
      color,
    });
  }

  const textRun = new TextRun({
    text,
    bold: run.bold,
    italics: run.italic,
    underline: run.underline ? {} : undefined,
    strike: run.strike,
    color,
    size,
    font: fontConfig,
    rightToLeft: isRtl ? true : undefined,
    superScript: run.sup,
    subScript: run.sub,
  });

  if (run.link?.url) {
    return new ExternalHyperlink({
      children: [textRun],
      link: run.link.url,
    });
  }

  return textRun;
}

function mapBorderDef(b?: BorderDef): any {
  if (!b || b.style === 'nil') return undefined;
  return {
    style: BorderStyle.SINGLE,
    size: b.size || 4,
    color: b.color ? b.color.replace('#', '') : '334155',
  };
}

function emitTable(table: Table, binaryStore: Map<string, Uint8Array>): DocxTable {
  const colWidthsTwips = table.colWidths.map((w) => ptToTwips(w));
  const totalWidthTwips = colWidthsTwips.reduce((acc, w) => acc + w, 0);

  const rows = table.rows.map((row) => {
    const cells = row.cells.map((cell) => {
      const cellChildren = cell.blocks
        .map((b) => emitBlock(b, binaryStore))
        .filter((el): el is Paragraph | DocxTable => el !== null);

      let verticalAlign: (typeof VerticalAlign)[keyof typeof VerticalAlign] = VerticalAlign.TOP;
      if (cell.vAlign === 'center') verticalAlign = VerticalAlign.CENTER;
      else if (cell.vAlign === 'bottom') verticalAlign = VerticalAlign.BOTTOM;

      const cellBorders = cell.borders
        ? {
            top: mapBorderDef(cell.borders.top),
            bottom: mapBorderDef(cell.borders.bottom),
            left: mapBorderDef(cell.borders.left),
            right: mapBorderDef(cell.borders.right),
          }
        : undefined;

      return new DocxTableCell({
        width: {
          size: ptToTwips(cell.width),
          type: WidthType.DXA,
        },
        columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
        rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
        verticalAlign,
        borders: cellBorders,
        margins: {
          top: ptToTwips(5),
          bottom: ptToTwips(5),
          left: ptToTwips(7),
          right: ptToTwips(7),
        },
        shading: cell.fill
          ? {
              fill: cell.fill.replace('#', ''),
            }
          : undefined,
        children: cellChildren.length > 0 ? cellChildren : [new Paragraph('')],
      });
    });

    return new DocxTableRow({
      tableHeader: row.header,
      children: cells,
    });
  });

  const tableBorders = table.borders
    ? {
        top: mapBorderDef(table.borders.top),
        bottom: mapBorderDef(table.borders.bottom),
        left: mapBorderDef(table.borders.left),
        right: mapBorderDef(table.borders.right),
      }
    : undefined;

  return new DocxTable({
    width: {
      size: totalWidthTwips,
      type: WidthType.DXA,
    },
    columnWidths: colWidthsTwips,
    borders: tableBorders,
    rows,
  });
}

function emitImage(img: ImageBlock, binaryStore: Map<string, Uint8Array>): Paragraph {
  const data = binaryStore.get(img.ref);
  if (!data) {
    return new Paragraph('');
  }

  const imageRun = new ImageRun({
    data,
    type: 'png',
    transformation: {
      width: Math.round(img.w),
      height: Math.round(img.h),
    },
  });

  return new Paragraph({
    children: [imageRun],
  });
}
