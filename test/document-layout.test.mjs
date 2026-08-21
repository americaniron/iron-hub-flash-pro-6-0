// ISSUE-2: the same document rendered by the Suite and by Iron Hub Pro paginated differently,
// and Iron Hub Pro disagreed with itself.
//
// Before services/documentLayout.ts there were three geometries in this repository alone — the
// quote/invoice PDF export, the browser print stylesheet, and the payment receipt export — so
// printing a quote and exporting the same quote produced different pagination, and neither
// matched the Suite's copy of that quote.
//
// The two repositories cannot import from each other, so the Hub's module is a MIRROR of
// shared/document-layout.ts in the Suite. These tests are what stop the mirror from drifting.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hub = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');
const suiteLayoutPath = path.join(root, '../Iron-Hub-Suite2/shared/document-layout.ts');

test('the Hub page geometry matches the Suite it mirrors', { skip: !existsSync(suiteLayoutPath) && 'the Suite checkout is not beside this one' }, () => {
  const suite = readFileSync(suiteLayoutPath, 'utf8');
  const suiteMargin = (side) => {
    const match = new RegExp(`${side}: inchesToPoints\\(([\\d.]+)\\)`).exec(suite);
    assert.ok(match, `the Suite must state its ${side} margin`);
    return Number(match[1]);
  };
  const layout = hub('services/documentLayout.ts');
  const hubMargin = (side) => {
    const match = new RegExp(`${side}: inchesToPoints\\(([\\d.]+)\\)`).exec(layout);
    assert.ok(match, `the Hub must state its ${side} margin`);
    return Number(match[1]);
  };
  for (const side of ['top', 'right', 'bottom', 'left']) {
    assert.equal(hubMargin(side), suiteMargin(side), `the ${side} margin has drifted from the Suite`);
  }
  // The footer band is the bottom margin, and content that runs into it is the reported defect.
  assert.ok(hubMargin('bottom') > hubMargin('top'), 'the footer needs the deeper margin');
});

test('every PDF path reads its geometry from the module, not its own constants', () => {
  const app = hub('App.tsx');
  assert.match(app, /from '\.\/services\/documentLayout\.ts'/);
  assert.match(app, /margin:\s+DOCUMENT_HTML2PDF_MARGIN_IN,/);
  assert.doesNotMatch(app, /margin:\s+\[0\.35, 0\.42, 0\.35, 0\.42\]/, 'the export margin must not be a literal');

  const accounts = hub('components/AccountsSystem.tsx');
  assert.match(accounts, /from '\.\.\/services\/documentLayout\.ts'/);
  assert.match(accounts, /margin: RECEIPT_HTML2PDF_MARGIN_IN,/);
  assert.doesNotMatch(accounts, /margin: \[0\.25, 0\.5, 0\.85, 0\.5\]/, 'the receipt margin must not be a literal');
});

test('the print stylesheet reserves the same page as the export', () => {
  const markup = hub('index.html');
  const layout = hub('services/documentLayout.ts');
  const margin = (side) => Number(new RegExp(`${side}: inchesToPoints\\(([\\d.]+)\\)`).exec(layout)[1]);
  const page = /@page \{ size: LETTER; margin: ([\d.]+)in ([\d.]+)in ([\d.]+)in ([\d.]+)in; \}/.exec(markup);
  assert.ok(page, 'the print stylesheet must state its page margins');
  assert.deepEqual(
    page.slice(1, 5).map(Number),
    [margin('top'), margin('right'), margin('bottom'), margin('left')],
    'printing and exporting must use the same page',
  );
  // The footer band was reserved twice: 0.85in of @page margin AND 0.85in of padding, which is
  // why the print path broke a document onto more pages than the export of the same document.
  const padding = /padding-bottom: ([\d.]+)in !important;/.exec(markup);
  assert.ok(padding, 'the printable area must reserve the footer band');
  assert.equal(Number(padding[1]), margin('bottom'));
});

test('an exported PDF carries the footer and page numbers the printed one has', () => {
  // The DOM footer is `position: fixed` inside `@media print`. html2canvas rasterises SCREEN
  // media, so it never saw it: exports went out with no footer and no page numbers at all.
  const app = hub('App.tsx');
  assert.match(app, /drawDocumentFooter\(pdf, footerLines\)/);
  assert.match(app, /document\.querySelectorAll\('\.print-footer p'\)/);
  const layout = hub('services/documentLayout.ts');
  assert.match(layout, /pdf\.text\(`\$\{page\}\/\$\{pageCount\}`/, 'every page must be numbered');
  // jsPDF's built-in faces are WinAnsi and carry no Arabic glyphs. Drawing Arabic through them
  // does not fail, it draws the wrong characters — so those lines are left to the print path.
  assert.match(layout, /WIN_ANSI_REPRESENTABLE/);
  assert.match(layout, /footerLinesDrawableByJsPdf/);
});
