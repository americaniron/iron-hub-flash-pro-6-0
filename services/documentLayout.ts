/**
 * The single definition of a printed quote or invoice's geometry.
 *
 * MIRRORED FILE — the Suite keeps the same definition at shared/document-layout.ts. The two repos
 * deploy separately, so this is a copy rather than an import.
 *
 * What must stay identical is what decides pagination: the page size, the margins, and the band
 * reserved for the footer. test/document-layout.test.mjs reads the Suite's copy from the checkout
 * beside this one and fails if those drift. The column grids are deliberately NOT identical — the
 * Hub's line-item table carries a part image the Suite's does not — and each engine owns its own.
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


/**
 * The payment receipt's own band.
 *
 * A receipt is a Hub-only document; it is never synchronised to the Suite, so it does not have to
 * share the quote's content box. It does have to reserve room for its own footer, which is three
 * 8pt lines sitting 0.25in up — 0.65in in total — where a quote's are three 6.5pt lines sitting
 * 0.15in up. Its export reserved 0.85in while its @page reserved 0.85in again, and its own
 * html2pdf call passed a third geometry entirely.
 */
export const RECEIPT_MARGINS_IN = Object.freeze({
  top: 0.35,
  right: 0.5,
  bottom: 0.65,
  left: 0.5,
});

export const RECEIPT_HTML2PDF_MARGIN_IN: [number, number, number, number] = [
  RECEIPT_MARGINS_IN.top,
  RECEIPT_MARGINS_IN.left,
  RECEIPT_MARGINS_IN.bottom,
  RECEIPT_MARGINS_IN.right,
];

/** `@page { margin: … }` — CSS order is top right bottom left. */
export const DOCUMENT_PAGE_MARGIN_CSS =
  `${DOCUMENT_MARGINS_IN.top}in ${DOCUMENT_MARGINS_IN.right}in ${DOCUMENT_MARGINS_IN.bottom}in ${DOCUMENT_MARGINS_IN.left}in`;

/**
 * jsPDF's built-in faces are WinAnsi-encoded and carry no Arabic glyphs. Text outside that
 * encoding does not fail — it draws as the wrong characters, which is worse than not drawing it.
 * An Arabic footer line is therefore left to the print path, which uses the browser's own fonts.
 */
const WIN_ANSI_REPRESENTABLE = /^[\u0020-\u007E\u00A0-\u00FF\u2018\u2019\u201C\u201D\u2013\u2014\u20AC]*$/;

export function footerLinesDrawableByJsPdf(lines: readonly string[]): string[] {
  return lines
    .map((line) => String(line || "").trim())
    .filter((line) => line.length > 0 && WIN_ANSI_REPRESENTABLE.test(line));
}

type JsPdfLike = {
  internal: { getNumberOfPages(): number; pageSize: { getWidth(): number; getHeight(): number } };
  setPage(page: number): void;
  setFontSize(size: number): void;
  setTextColor(r: number, g: number, b: number): void;
  text(text: string, x: number, y: number, options?: { align?: string }): void;
};

/**
 * Draw the repeated page footer onto a finished jsPDF document.
 *
 * The DOM footer is `position: fixed` inside `@media print`, and html2canvas rasterises SCREEN
 * media, so it never saw it: every exported PDF went out with no address, no telephone and no
 * page numbers, while the same document printed from the browser had all three. A fixed element
 * could not have repeated per page under html2canvas in any case — it would have been rasterised
 * once, wherever it happened to land.
 *
 * Mirrors what the Suite's Worker draws: contact lines on the left, page counter on the right,
 * both inside the bottom margin band.
 */
export function drawDocumentFooter(
  pdf: JsPdfLike,
  lines: readonly string[],
  margins: { left: number; right: number } = DOCUMENT_MARGINS_IN,
): void {
  const pageCount = pdf.internal.getNumberOfPages();
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const baselineIn = pointsToInches(DOCUMENT_PAGE.heightPt - DOCUMENT_FOOTER.baselinePt);
  const lineHeightIn = pointsToInches(DOCUMENT_FOOTER.fontSizePt * 1.2);
  const visible = footerLinesDrawableByJsPdf(lines);
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setFontSize(DOCUMENT_FOOTER.fontSizePt);
    pdf.setTextColor(108, 117, 125);
    visible.forEach((line, index) => {
      pdf.text(line, margins.left, height - baselineIn - (visible.length - 1 - index) * lineHeightIn);
    });
    pdf.text(`${page}/${pageCount}`, width - margins.right, height - baselineIn, { align: "right" });
  }
}
