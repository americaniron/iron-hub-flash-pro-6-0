/**
 * Unit tests for the layout-driven parser core.
 *
 * These run against synthetic page models wherever possible so a failure points at one rule
 * rather than at a PDF.  Fixture-level assertions live in parser-fixtures.test.mjs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './support/harness.mjs';

const geometry = await loadModule('services/parser/geometry.ts');
const partNumber = await loadModule('services/parser/partNumber.ts');
const valueShapes = await loadModule('services/parser/valueShapes.ts');
const core = await loadModule('services/parser/core.ts');
const validate = await loadModule('services/parser/validate.ts');
const summaryModule = await loadModule('services/parser/documentSummary.ts');

/** Build a text item; x1 and the baseline are derived so tests stay readable. */
function item(text, x0, top, { width = text.length * 5, fontSize = 9 } = {}) {
  return { text, x0, x1: x0 + width, top, bottom: top + fontSize, fontSize };
}

function page(width, height, items, pageNumber = 1) {
  return { pageNumber, width, height, items };
}

// --------------------------------------------------------------------------------------------
// Part-number families
// --------------------------------------------------------------------------------------------

test('the part-number families accept every known-good number', () => {
  const good = [
    '539-0546', '319-0677', '366-8821', '381-2499', '317-8021',
    '583-9600', '175-6779',
    '10R-7672', '1R-0750', '8T-1234', '4W-9999',
  ];
  for (const value of good) {
    const verdict = partNumber.classifyPartNumber(value);
    assert.equal(verdict.ok, true, `${value} should be accepted but was rejected: ${verdict.reason}`);
    assert.equal(verdict.value, value);
  }
});

test('the part-number guard rejects every string the old parser mistook for a part number', () => {
  // Each of these was returned as `partNo` on a real customer document.
  const garbage = [
    'ONLINE25',
    'BILLING METHOD',
    'Payment Information',
    'SUMMARY OF CHARGES',
    '25 LBS',
    '2.1 LBS',
    'HYDRAULIC',
    '5 2 . 6 L B S',
    '25% off order, min order value $25, max …',
  ];
  for (const value of garbage) {
    const verdict = partNumber.classifyPartNumber(value);
    assert.equal(verdict.ok, false, `${value} should be rejected but was accepted as ${verdict.family}`);
  }
});

test('10R-7672 needs the two-digit alpha family, not the single-digit one', () => {
  // Regression guard: /^\d[A-Z]-\d{4}$/ cannot match 10R-7672, a real reman injector number.
  assert.equal(partNumber.classifyPartNumber('10R-7672').family, 'cat-alpha');
  assert.equal(partNumber.classifyPartNumber('1R-0750').family, 'cat-alpha');
});

test('a trailing colon is stripped and a date is never a part number', () => {
  assert.equal(partNumber.classifyPartNumber('539-0546:').value, '539-0546');
  assert.equal(partNumber.classifyPartNumber('20260403').ok, false);
  assert.equal(partNumber.classifyPartNumber('9/9/26').ok, false);
});

test('a candidate that is also a section heading on the page is refused', () => {
  const headings = new Set(['583-9600']);
  assert.equal(partNumber.classifyPartNumber('583-9600').ok, true);
  assert.equal(partNumber.classifyPartNumber('583-9600', { headings }).ok, false);
});

// --------------------------------------------------------------------------------------------
// Geometry
// --------------------------------------------------------------------------------------------

test('letter-spaced runs are collapsed and re-separated, ordinary prose is not', () => {
  assert.equal(geometry.collapseLetterSpacing('5 2 . 6 L B S'), '52.6 LBS');
  assert.equal(geometry.collapseLetterSpacing('S TAT U S : 7 D AY S'), 'STATUS: 7 DAYS');
  assert.equal(geometry.collapseLetterSpacing('AIR COMPRESSOR 1 CLAYTON'), 'AIR COMPRESSOR 1 CLAYTON');
});

test('adjacent glyph runs join without a space so split part numbers survive', () => {
  // pdfjs emits "319", "−", "0677" edge to edge; joining with spaces destroyed the number.
  const parts = [
    { text: '319', x0: 76.9, x1: 92.6, top: 330, bottom: 338, fontSize: 9.6 },
    { text: '−', x0: 92.6, x1: 99.1, top: 330, bottom: 338, fontSize: 9.6 },
    { text: '0677', x0: 99.1, x1: 122.4, top: 330, bottom: 338, fontSize: 9.6 },
  ];
  assert.equal(geometry.joinItems(parts), '319−0677');
  assert.equal(partNumber.classifyPartNumber(geometry.joinItems(parts)).value, '319-0677');
});

test('a genuine word gap still produces a space', () => {
  const words = [
    { text: 'FUEL', x0: 100, x1: 120, top: 10, bottom: 19, fontSize: 9 },
    { text: 'PUMP', x0: 126, x1: 148, top: 10, bottom: 19, fontSize: 9 },
  ];
  assert.equal(geometry.joinItems(words), 'FUEL PUMP');
});

test('the same table is found on A4 and on Letter', () => {
  // Identical logical layout, expressed at both page widths.  Nothing may depend on absolute x.
  const build = (width) => {
    const scale = width / 612;
    return page(width, width * (792 / 612), [
      item('Item', 16 * scale, 60),
      item('Quantity', 73 * scale, 60),
      item('Product Description', 193 * scale, 60),
      item('Total Price', 498 * scale, 60),
      item('1', 16 * scale, 96),
      item('1', 73 * scale, 96),
      item('539-0546: Widget', 193 * scale, 96),
      item('$100.00', 498 * scale, 96),
    ]);
  };
  for (const width of [612, 594.96, 612 * 1.166]) {
    const model = build(width);
    const header = geometry.detectHeader(geometry.groupRows(model), model);
    assert.ok(header, `no header detected at page width ${width}`);
    const roles = header.columns.map((c) => c.role).sort();
    assert.deepEqual(roles, ['desc', 'extended', 'item', 'qty']);
    const result = core.extractItems([model]);
    assert.equal(result.items.length, 1, `wrong item count at page width ${width}`);
    assert.equal(result.items[0].partNo, '539-0546');
  }
});

test('a header staggered across three y-bands is detected as one header', () => {
  // Chrome's print stylesheet puts "Total Price/USD" at y=63, the main header at y=70 and
  // "Availability" at y=78.  Reading only the row containing "Quantity" finds no price column.
  const model = page(594.96, 841.92, [
    item('Total Price', 498, 55),
    item('USD', 554, 55),
    item('Item', 16, 62),
    item('Quantity', 73, 62),
    item('Product Description', 193, 62),
    item('Availability', 523, 70),
  ]);
  const header = geometry.detectHeader(geometry.groupRows(model), model);
  assert.ok(header);
  assert.ok(header.rows.length >= 3, 'the staggered bands should merge into one header zone');
  const roles = header.columns.map((c) => c.role).sort();
  assert.deepEqual(roles, ['availability', 'desc', 'extended', 'item', 'qty']);
});

test('a section title above the header is not mistaken for the Item column', () => {
  // "Items In Your Order" once matched the "item" role by prefix, widening that column across
  // half the page and swallowing the quantity value.
  assert.equal(geometry.headerRole('Items In Your Order'), null);
  assert.equal(geometry.headerRole('Item'), 'item');
  assert.equal(geometry.headerRole('Total PriceUSD'), 'extended');
  assert.equal(geometry.headerRole('Total Price (USD)'), 'extended');
});

test('a wide description cell is not stolen by the next column', () => {
  // The description header is narrow and centred at x=194 while its content runs to x=372;
  // nearest-centre assignment handed that content to QTY, whose centre sat at x=399.
  const model = page(612, 792, [
    item('LIN', 45, 372, { width: 12 }),
    item('PART NUMBER', 77, 372, { width: 60 }),
    item('DESCRIPTION', 174, 372, { width: 60 }),
    item('QTY', 390, 372, { width: 17 }),
    item('UNIT VAL', 448, 372, { width: 38 }),
    item('175−6779', 77, 415, { width: 47 }),
    item('AIR COMPRESSOR 1 CLAYTON', 241, 415, { width: 131 }),
    item('1', 402, 415, { width: 4 }),
    item('$52.60', 448, 415, { width: 30 }),
  ]);
  const rows = geometry.groupRows(model);
  const header = geometry.detectHeader(rows, model);
  const bodyRow = rows.find((r) => r.text.includes('AIR COMPRESSOR'));
  assert.equal(geometry.cellText(bodyRow, header.columns, 'desc'), 'AIR COMPRESSOR 1 CLAYTON');
  assert.equal(geometry.cellText(bodyRow, header.columns, 'qty'), '1');
});

// --------------------------------------------------------------------------------------------
// Price-cell disambiguation
// --------------------------------------------------------------------------------------------

test('the price zone is read by value shape, not by position', () => {
  const reading = valueShapes.readPriceZone([
    { role: 'extended', text: '$2,086.82' },
    { role: 'availability', text: 'USD' },
    { role: 'extended', text: '$2,086.82 Ea.' },
    { role: 'extended', text: '1 CAT ATLANTA' },
    { role: 'availability', text: '(2 Days)' },
  ]);
  assert.equal(reading.extendedPrice, 2086.82);
  assert.equal(reading.unitPrice, 2086.82);
  assert.equal(reading.currency, 'USD');
  assert.equal(reading.availability, '1 CAT ATLANTA');
  assert.equal(reading.leadTime, '2 Days');
});

test('two bare amounts on one row are separated by the column they came from', () => {
  // A reman injector line carrying $526.73 each and $3,160.38 extended was previously read as
  // $526.73 extended, from which a unit price of $87.79 was invented.
  const reading = valueShapes.readPriceZone([
    { role: 'unitPrice', text: '$526.73' },
    { role: 'extended', text: '$3,160.38' },
  ]);
  assert.equal(reading.unitPrice, 526.73);
  assert.equal(reading.extendedPrice, 3160.38);
});

test('availability and a price sharing one cell are both recovered', () => {
  const reading = valueShapes.readPriceZone([{ role: 'extended', text: 'All 1 by Sep 02 $6,808.54' }]);
  assert.equal(reading.availability, 'All 1 by Sep 02');
  assert.equal(reading.extendedPrice, 6808.54);
});

test('a redacted price is reported as redacted rather than as zero', () => {
  const reading = valueShapes.readPriceZone([{ role: 'unitPrice', text: '$ xxxxxxxxxx' }]);
  assert.equal(reading.unitPrice, undefined);
  assert.match(reading.warnings.join(' '), /redacted/i);
});

test('weights are read in both units and normalised to pounds', () => {
  assert.equal(valueShapes.readWeight('Weight (1.5 lbs.)'), 1.5);
  assert.equal(valueShapes.readWeight('463.53 lbs'), 463.53);
  assert.equal(valueShapes.readWeight('25 LBS'), 25);
  assert.equal(valueShapes.readWeight('10 kg'), 22.05);
  assert.equal(valueShapes.readWeight('no weight here'), null);
});

// --------------------------------------------------------------------------------------------
// Multi-row items
// --------------------------------------------------------------------------------------------

test('one logical item spanning five visual rows becomes one item, not five', () => {
  const model = page(594.96, 841.92, [
    item('Item', 16, 62), item('Quantity', 73, 62), item('Product Description', 193, 62),
    item('Total Price', 498, 55), item('Availability', 523, 70),
    item('1', 16, 98), item('1', 73, 98), item('539-0546: Transmission', 193, 100),
    item('$2,086.82', 494, 101),
    item('Gasket Kit', 193, 115), item('$2,086.82 Ea.', 515, 118),
    item('Non-returnable part', 208, 131),
    item('1 CAT ATLANTA', 503, 139),
    item('Weight (1.5 lbs.)', 208, 146),
    item('(2 Days)', 541, 154),
  ]);
  const result = core.extractItems([model]);
  assert.equal(result.items.length, 1);
  const [only] = result.items;
  assert.equal(only.partNo, '539-0546');
  // The wrap must be joined: not "539-0546: Transmission", not "Transmission" alone.
  assert.equal(only.desc, 'Transmission Gasket Kit');
  assert.equal(only.weight, 1.5);
  assert.match(only.notes, /Non-returnable part/);
  assert.match(only.notes, /Weight \(1\.5 lbs\.\)/);
});

test('noise sublines never become their own line items', () => {
  const model = page(594.96, 841.92, [
    item('Item', 16, 62), item('Quantity', 73, 62), item('Product Description', 193, 62),
    item('Total Price', 498, 62),
    item('1', 16, 98), item('1', 73, 98), item('539-0546: Widget', 193, 98), item('$10.00', 498, 98),
    item('Non-returnable part', 208, 112),
    item('Weight (1.5 lbs.)', 208, 126),
  ]);
  const result = core.extractItems([model]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items.some((i) => /Non-returnable|Weight/.test(i.partNo)), false);
});

test('scaffolding printed above the part number is attached to the item below it', () => {
  // IRON HUB's own quote template prints the line number, quantity and prices on a band ABOVE
  // the part number; attaching only downwards orphaned that row and lost the price with it.
  const model = page(612, 792, [
    item('LIN', 45, 372, { width: 12 }), item('PART NUMBER', 77, 372, { width: 60 }),
    item('DESCRIPTION', 174, 372, { width: 60 }), item('QTY', 390, 372, { width: 17 }),
    item('UNIT VAL', 448, 372, { width: 38 }),
    item('01', 45, 410, { width: 11 }), item('2', 402, 410, { width: 4 }),
    item('$25.00', 448, 410, { width: 30 }),
    item('175−6779', 77, 424, { width: 47 }),
    item('AIR COMPRESSOR', 241, 424, { width: 80 }),
  ]);
  const result = core.extractItems([model]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].partNo, '175-6779');
  assert.equal(result.items[0].qty, 2);
  assert.equal(result.items[0].unitPrice, 25);
  assert.equal(result.items[0].lineNo, '01');
});

// --------------------------------------------------------------------------------------------
// Structured failure
// --------------------------------------------------------------------------------------------

test('an empty page is diagnosed as having no text layer', () => {
  const result = core.extractItems([page(612, 792, [])]);
  assert.equal(result.items.length, 0);
  assert.equal(result.failure.kind, 'no-text-layer');
});

test('text without an item table is diagnosed as a missing header', () => {
  const result = core.extractItems([
    page(612, 792, [item('Thank you for your business', 40, 100), item('Remit to PO Box 1', 40, 120)]),
  ]);
  assert.equal(result.failure.kind, 'no-header');
  assert.match(result.failure.textPreview, /Thank you/);
});

// --------------------------------------------------------------------------------------------
// Validation layer
// --------------------------------------------------------------------------------------------

test('validation drops garbage part numbers and records why', () => {
  const { accepted, rejected, warnings } = validate.validateItems([
    { partNo: '539-0546', desc: 'Real', unitPrice: 10 },
    { partNo: 'SUMMARY OF CHARGES', desc: '', unitPrice: 0 },
    { partNo: '25 LBS', desc: '', unitPrice: 0 },
  ]);
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 2);
  assert.match(warnings.join(' '), /rejected by part-number validation/);
});

test('a blank part number survives only when the rest of the line is complete', () => {
  const complete = validate.validateItems(
    [{ partNo: '', desc: 'HYDRAULIC CONTROL VALVE', unitPrice: 24.46 }],
    { allowBlankPartNumbers: true },
  );
  assert.equal(complete.accepted.length, 1);

  const bare = validate.validateItems([{ partNo: '', desc: '', unitPrice: 0 }], {
    allowBlankPartNumbers: true,
  });
  assert.equal(bare.accepted.length, 0);
});

// --------------------------------------------------------------------------------------------
// Document summary
// --------------------------------------------------------------------------------------------

test('a two-digit order date is normalised to ISO', () => {
  assert.equal(summaryModule.normalizeShortDate('9/9/26'), '2026-09-09');
  assert.equal(summaryModule.normalizeShortDate('By Sep 02'), 'By Sep 02');
});
