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
import { DocAST, Block, Para, Run, Table, ImageBlock, Borders } from '../core/ast.js';
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

function emitParagraph(para: Para): Paragraph {
  const children = para.runs.map((r) => emitRun(r));

  let alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT;
  if (para.align === 'center') alignment = AlignmentType.CENTER;
  else if (para.align === 'right') alignment = AlignmentType.RIGHT;
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
  const color = run.color ? run.color.replace('#', '') : undefined;
  const size = Number.isFinite(run.size) && (run.size ?? 0) > 0 ? ptToHalfPoints(run.size!) : 22;

  // Support dynamic PAGE field
  if (text === 'PAGE') {
    return new TextRun({
      children: [PageNumber.CURRENT],
      font: run.font || 'Calibri',
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
    font: run.font || 'Calibri',
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

      return new DocxTableCell({
        width: {
          size: ptToTwips(cell.width),
          type: WidthType.DXA,
        },
        columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
        rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
        verticalAlign,
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

  return new DocxTable({
    width: {
      size: totalWidthTwips,
      type: WidthType.DXA,
    },
    columnWidths: colWidthsTwips,
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
