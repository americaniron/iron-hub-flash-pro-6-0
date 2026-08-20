/**
 * The single definition of a printed quote or invoice's geometry.
 *
 * MIRRORED FILE — the Suite keeps the same definition at shared/document-layout.ts. The two repos
 * deploy separately, so this is a copy rather than an import; keep them byte-identical below the
 * header, and change both together.
 *
 * The Suite renders these documents with PDFKit inside the Worker; Iron Hub Pro renders them with
 * html2canvas + jsPDF in the browser. Two engines, and — until this file existed — two independent
 * sets of hand-tuned numbers, which is why a document synchronised from Iron Hub Pro paginated
 * differently and sat differently on the page than the original it came from.
 *
 * The engines still differ (one draws vector text from AFM metrics, the other rasterises a DOM),
 * so pixel-identical output is not achievable and is not claimed. What IS identical is every
 * measurable property of the page: size, margins, the band reserved for the footer, the column
 * proportions, the rule that a row may never split, and the rule that the totals block may never
 * be orphaned.
 *
 * Iron Hub Pro also disagreed with ITSELF: its print stylesheet used 0.45/0.5/0.55/0.5in while its
 * html2pdf path used 0.35/0.42/0.35/0.42in, so printing a quote and exporting the same quote
 * produced different pagination. Both now come from here.
 *
 * All values are PostScript points (1pt = 1/72in) unless the name says otherwise.
 */

export const POINTS_PER_INCH = 72;

export const inchesToPoints = (inches: number): number => inches * POINTS_PER_INCH;
export const pointsToInches = (points: number): number => points / POINTS_PER_INCH;

/** US Letter, portrait. Both renderers are pinned to this; neither may infer it from content. */
export const DOCUMENT_PAGE = Object.freeze({
  widthPt: 612,
  heightPt: 792,
  jsPdfFormat: "letter" as const,
  pdfKitSize: "LETTER" as const,
});

/**
 * Page margins.
 *
 * The bottom margin is deliberately the largest: it is the band the page footer occupies, and
 * content that runs into it is the defect this issue was reported for.
 */
export const DOCUMENT_MARGINS_PT = Object.freeze({
  top: inchesToPoints(0.35),
  right: inchesToPoints(0.42),
  bottom: inchesToPoints(0.55),
  left: inchesToPoints(0.42),
});

export const DOCUMENT_MARGINS_IN = Object.freeze({
  top: pointsToInches(DOCUMENT_MARGINS_PT.top),
  right: pointsToInches(DOCUMENT_MARGINS_PT.right),
  bottom: pointsToInches(DOCUMENT_MARGINS_PT.bottom),
  left: pointsToInches(DOCUMENT_MARGINS_PT.left),
});

/** html2pdf takes [top, left, bottom, right] in inches. */
export const DOCUMENT_HTML2PDF_MARGIN_IN: [number, number, number, number] = [
  DOCUMENT_MARGINS_IN.top,
  DOCUMENT_MARGINS_IN.left,
  DOCUMENT_MARGINS_IN.bottom,
  DOCUMENT_MARGINS_IN.right,
];

export const DOCUMENT_CONTENT = Object.freeze({
  left: DOCUMENT_MARGINS_PT.left,
  right: DOCUMENT_PAGE.widthPt - DOCUMENT_MARGINS_PT.right,
  width: DOCUMENT_PAGE.widthPt - DOCUMENT_MARGINS_PT.left - DOCUMENT_MARGINS_PT.right,
  /** No drawing may cross this line. The footer lives below it. */
  bottomLimit: DOCUMENT_PAGE.heightPt - DOCUMENT_MARGINS_PT.bottom,
  /** Where content resumes on a continuation page. */
  continuationTop: DOCUMENT_MARGINS_PT.top + 16.8,
});

/** Baseline of the repeated page footer, measured from the top of the page. */
export const DOCUMENT_FOOTER = Object.freeze({
  baselinePt: DOCUMENT_PAGE.heightPt - inchesToPoints(0.36),
  fontSizePt: 7,
});

/**
 * Line-item table columns, as fractions of the content width so both engines lay out the same
 * table at any page size. They sum to 1.
 */
export const DOCUMENT_TABLE_COLUMNS = Object.freeze([
  { key: "index", fraction: 0.052, align: "left" as const },
  { key: "part", fraction: 0.178, align: "left" as const },
  { key: "image", fraction: 0.086, align: "center" as const },
  { key: "description", fraction: 0.302, align: "left" as const },
  { key: "quantity", fraction: 0.082, align: "center" as const },
  { key: "unitPrice", fraction: 0.148, align: "center" as const },
  { key: "amount", fraction: 0.152, align: "right" as const },
]);

export const DOCUMENT_ROW_RULES = Object.freeze({
  /** A row is placed whole or not at all — never split across a page boundary. */
  neverSplit: true,
  minHeightPt: 76,
  /** Padding above and below the tallest cell in a row. */
  chromePt: 34,
  /** The column header band is redrawn at the top of every continuation page. */
  repeatHeaderOnContinuation: true,
  headerHeightPt: 46,
});

export const DOCUMENT_TOTALS = Object.freeze({
  /** The totals block is placed whole, and never alone at the top of a page of its own. */
  neverOrphan: true,
  baseHeightPt: 178,
  rowPitchPt: 24,
  widthPt: 218,
  /** Vertical space between the last line item and the totals block. */
  gapPt: 32,
});

/**
 * Fonts.
 *
 * The Worker uses PDFKit's standard-14 faces, whose metrics are bundled with the library, so text
 * is measured with the same metrics it is drawn with and nothing can substitute underneath it.
 * The browser renderer uses a web font, which CAN silently substitute if the PDF is generated
 * before the font finishes loading — the caller must await `document.fonts.ready` first.
 */
export const DOCUMENT_FONTS = Object.freeze({
  pdfKit: { regular: "Helvetica", bold: "Helvetica-Bold" },
  browser: { family: "'Plus Jakarta Sans', sans-serif", mono: "'JetBrains Mono', monospace" },
  requiresWebFontReady: true,
});

/** Column x-offset and width in points, given the content box. */
export function documentColumnBox(key: string): { x: number; width: number } {
  let offset = DOCUMENT_CONTENT.left;
  for (const column of DOCUMENT_TABLE_COLUMNS) {
    const width = DOCUMENT_CONTENT.width * column.fraction;
    if (column.key === key) return { x: offset, width };
    offset += width;
  }
  throw new Error(`Unknown document column: ${key}`);
}
