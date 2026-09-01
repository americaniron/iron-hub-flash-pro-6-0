/**
 * Acceptance tests against the real supplier PDFs in fixtures/quotes.
 *
 * Every fixture on disk must parse correctly or fail with a specific diagnosis.  "Parses without
 * throwing" is explicitly not the bar: before this suite existed, four of these six threw no
 * error and returned section headings and weights as part numbers.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileFromPath, loadModule, loadParserService, pageModelsFromPdf, repoRoot } from './support/harness.mjs';

const core = await loadModule('services/parser/core.ts');
const parser = await loadParserService();

const fixture = (name) => path.join(repoRoot, 'fixtures/quotes', name);
const parse = (name) => parser.parsePdfFile(fileFromPath(fixture(name)));

/** No item on any fixture may carry one of the strings the old parser produced. */
function assertNoGarbagePartNumbers(items, label) {
  for (const item of items) {
    assert.doesNotMatch(item.partNo, /\b(?:LBS?|KGS?|OZ)\b/i, `${label}: unit in partNo "${item.partNo}"`);
    assert.doesNotMatch(item.partNo, /\$|%/, `${label}: currency in partNo "${item.partNo}"`);
    assert.ok(!/\s/.test(item.partNo.trim()), `${label}: multi-word partNo "${item.partNo}"`);
    assert.doesNotMatch(
      item.partNo,
      /^(?:BILLING METHOD|Payment Information|SUMMARY OF CHARGES|ONLINE25|HYDRAULIC)$/i,
      `${label}: section heading as partNo "${item.partNo}"`,
    );
  }
}

test('the September 2026 Parts.Cat.Com order yields exactly one correct line item', async () => {
  const result = await parse('cat-partscatcom-2026-09.pdf');
  assert.equal(result.items.length, 1);
  const [only] = result.items;
  assert.equal(only.lineNo, '1');
  assert.equal(only.qty, 1);
  assert.equal(only.partNo, '539-0546');
  assert.equal(only.desc, 'Transmission Gasket Kit');
  assert.equal(only.unitPrice, 2086.82);
  assert.equal(only.extendedPrice, 2086.82);
  assert.equal(only.currency, 'USD');
  assert.equal(only.availability, '1 CAT ATLANTA');
  assert.equal(only.leadTime, '2 Days');
  assert.match(only.notes, /Non-returnable part/);
  assert.match(only.notes, /Weight \(1\.5 lbs\.\)/);
  assert.equal(only.weight, 1.5);
});

test('the September 2026 order header block is captured', async () => {
  const { summary } = await parse('cat-partscatcom-2026-09.pdf');
  assert.equal(summary.subtotal, 2086.82);
  assert.equal(summary.shipping, 0);
  assert.equal(summary.total, 2086.82);
  assert.equal(summary.appliedOffers, 208.68);
  assert.equal(summary.accountNumber, '025069-AMERICAN IRON LLC');
  assert.equal(summary.dealerStore, 'Tampa');
  assert.equal(summary.requestByDate, '2026-09-09');
  assert.equal(summary.orderType, 'Standard');
  assert.equal(summary.orderedBy, 'ADAM qadah');
});

test('applied offers are parsed for audit but reach nothing user-facing', async () => {
  // Policy: the supplier does not deduct the discount from its own printed total, so whether
  // Caterpillar honours it at invoicing is unconfirmed.  On this order it is exactly 10.00% of
  // subtotal, so auto-deducting would move real margin on an assumption.  Keep the number,
  // surface nothing, and let it touch neither the total nor the reconciliation.
  const { summary, warnings, reconciliation } = await parse('cat-partscatcom-2026-09.pdf');
  assert.equal(summary.appliedOffers, 208.68);
  assert.equal(Math.round((summary.appliedOffers / summary.subtotal) * 10000) / 100, 10);
  assert.equal(summary.total, 2086.82, 'the printed total must be reported exactly as printed');
  assert.doesNotMatch(warnings.join(' '), /applied offers/i);
  assert.equal(reconciliation.balanced, true, 'applied offers must not unbalance the check');
});

test('BOYD reconciles once its printed shipping line is accounted for', async () => {
  // 6,808.54 of line items + 208.49 Shipping/Miscellaneous + 0.00 Total Tax = 7,017.03, the
  // printed ORDER TOTAL.  The 208.49 is a charge row on page 2, not a dropped line item.
  const { items, summary, reconciliation } = await parse('cat-partscatcom-boyd-2026-08.pdf');
  assert.equal(items.length, 1);
  assert.equal(reconciliation.itemsTotal, 6808.54);
  assert.equal(summary.subtotal, 6808.54);
  assert.equal(summary.shipping, 208.49);
  assert.equal(summary.tax, 0);
  assert.equal(summary.total, 7017.03);
  assert.equal(
    Math.round((reconciliation.itemsTotal + summary.shipping + summary.tax) * 100) / 100,
    summary.total,
  );
  assert.equal(reconciliation.balanced, true);
});

test('every fixture with readable prices reconciles against its printed totals', async () => {
  for (const name of [
    'cat-partscatcom-2026-09.pdf',
    'cat-partscatcom-boyd-2026-08.pdf',
    'ironhub-invoice-2026-04.pdf',
    'ironhub-quote-roundtrip-2026-02.pdf',
  ]) {
    const { reconciliation } = await parse(name);
    assert.equal(reconciliation.balanced, true, `${name} did not reconcile: ${reconciliation.warnings.join(' ')}`);
  }
});

test('a document whose prices cannot be read reports the imbalance instead of hiding it', async () => {
  // Prices on this quote are printed as "xxxxxxxxxx".  The right outcome is a loud mismatch,
  // never a figure adjusted to make the arithmetic close.
  const { summary, reconciliation } = await parse('ironhub-quote-redacted-2026-03.pdf');
  assert.equal(reconciliation.balanced, false);
  assert.equal(reconciliation.itemsTotal, 0);
  assert.equal(summary.subtotal, 121517.54, 'the printed subtotal must be left exactly as printed');
  assert.match(reconciliation.warnings.join(' '), /nothing has been adjusted/);
});

test('the geometry core parses the new Caterpillar format with every adapter disabled', async () => {
  // Adapters raise confidence; they are never load-bearing.
  const pages = await pageModelsFromPdf(fixture('cat-partscatcom-2026-09.pdf'));
  const result = core.extractItems(pages, {});
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].partNo, '539-0546');
  assert.equal(result.items[0].desc, 'Transmission Gasket Kit');
  assert.equal(result.items[0].unitPrice, 2086.82);
});

test('the BOYD order returns its one real item and no section headings', async () => {
  // This document previously "succeeded" with six items: ONLINE25, a promotion blurb,
  // Payment Information, BILLING METHOD, Billing Address and SUMMARY OF CHARGES.
  const result = await parse('cat-partscatcom-boyd-2026-08.pdf');
  assert.equal(result.items.length, 1);
  const [only] = result.items;
  assert.equal(only.partNo, '583-9600');
  assert.equal(only.desc, 'Engine Cylinder Head');
  assert.equal(only.qty, 1);
  assert.equal(only.unitPrice, 6808.54);
  assert.equal(only.extendedPrice, 6808.54);
  assert.equal(only.weight, 463.53);
  assertNoGarbagePartNumbers(result.items, 'BOYD');
});

test('a quote this app exports re-imports with matching part numbers', async () => {
  // Round trip: the fixture is IRON HUB's own generated quote (Title: "IRON HUB | Enterprise
  // Quoting").  It previously came back with part numbers of "25 LBS", "6 LBS" and "2.1 LBS" —
  // the weight column — while the real numbers sat unparsed in the description.
  const result = await parse('ironhub-quote-roundtrip-2026-02.pdf');
  assert.deepEqual(
    result.items.map((i) => i.partNo),
    ['319-0677', '366-8821', '381-2499', '317-8021', '10R-7672'],
  );
  assert.deepEqual(result.items.map((i) => i.qty), [1, 1, 1, 1, 6]);
  assert.deepEqual(
    result.items.map((i) => i.unitPrice),
    [3423.26, 3639.21, 942.93, 4197.5, 526.73],
  );
  // Weights belong in the weight field and never in partNo.
  assert.deepEqual(result.items.map((i) => i.weight), [25, 6, 2.1, 20.8, 1.2]);
  assert.equal(result.items[4].coreDeposit, 148.27);
  assertNoGarbagePartNumbers(result.items, 'round trip');

  // The extended prices must reconcile against the subtotal the document prints.
  const sum = result.items.reduce((total, i) => total + (i.extendedPrice ?? 0), 0);
  assert.equal(Math.round(sum * 100) / 100, 15363.28);
  assert.equal(result.summary.subtotal, 15363.28);
});

test('the redacted quote recovers its part number and reports the price as unreadable', async () => {
  // Its prices are printed as "xxxxxxxxxx".  The correct outcome is the real part number plus a
  // loud warning, not a fabricated price and not "5 2 . 6 L B S" as the part number.
  const result = await parse('ironhub-quote-redacted-2026-03.pdf');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].partNo, '175-6779');
  assert.equal(result.items[0].weight, 52.6);
  assert.match(result.items[0].desc, /AIR COMPRESSOR/);
  assert.equal(result.items[0].unitPrice, 0);
  assert.match(result.items[0].warnings.join(' '), /redacted|no price/i);
  assertNoGarbagePartNumbers(result.items, 'redacted');
});

test('an invoice with a genuinely blank part-number column keeps the line and says so', async () => {
  // The part-number column really is empty on this document.  Inventing "HYDRAULIC" from the
  // description is worse than an honest blank, and dropping the line loses a real charge.
  const result = await parse('ironhub-invoice-2026-04.pdf');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].partNo, '');
  assert.equal(result.items[0].desc, 'HYDRAULIC CONTROL VALVE');
  assert.equal(result.items[0].unitPrice, 24.46);
  assert.match(result.items[0].warnings.join(' '), /no part number/i);
  assertNoGarbagePartNumbers(result.items, 'invoice');
});

test('an image-only PDF fails with a specific diagnosis instead of a generic message', async () => {
  await assert.rejects(
    () => parse('ironhub-quote-imageonly-2026-04.pdf'),
    (error) => {
      assert.match(error.message, /no text layer/i);
      assert.doesNotMatch(error.message, /No items detected in source/);
      return true;
    },
  );
});

test('no fixture produces a part number that fails the guard', async () => {
  const parseable = [
    'cat-partscatcom-2026-09.pdf',
    'cat-partscatcom-boyd-2026-08.pdf',
    'ironhub-quote-roundtrip-2026-02.pdf',
    'ironhub-quote-redacted-2026-03.pdf',
    'ironhub-invoice-2026-04.pdf',
  ];
  for (const name of parseable) {
    const result = await parse(name);
    assert.ok(result.items.length > 0, `${name} produced no items`);
    assertNoGarbagePartNumbers(result.items, name);
  }
});

test('the legacy strategies are still registered and still reachable', async () => {
  // They are unexercised by these fixtures but not by production: a real Ring Power or
  // Dobbs/Deere quote would still land on them, so they must remain wired into the chain.
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync(path.join(repoRoot, 'services/parserService.ts'), 'utf8'),
  );
  for (const name of ['ring-power', 'john-deere', 'table-based', 'fallback', 'fuzzy']) {
    assert.match(source, new RegExp(`name: '${name}'`), `legacy strategy ${name} is not registered`);
  }
  for (const fn of [
    'parseRingPowerPage',
    'parseJohnDeerePage',
    'parseTableBasedPage',
    'parseFallback',
    'parseFuzzy',
  ]) {
    assert.match(source, new RegExp(`function ${fn}\\(`), `legacy function ${fn} was removed`);
  }
});

test('a disagreement between the core and a legacy strategy is recorded, and the core wins', async () => {
  const result = await parse('cat-partscatcom-boyd-2026-08.pdf');
  assert.equal(result.strategy.startsWith('geometry-core'), true);
  // Recorded as engineering detail, not shown to the user: a salesperson reading "Legacy
  // strategy table-based found 6 items" learns nothing and stops reading the panel.
  assert.match(result.diagnostics.join(' '), /Legacy strategy "table-based" found 6 item\(s\)/);
  assert.doesNotMatch(result.warnings.join(' '), /Legacy strategy/);
});

test('the Intake Center panel carries checks, not engineering noise', async () => {
  const boyd = await parse('cat-partscatcom-boyd-2026-08.pdf');
  // Everything reconciles and every part number is present, so there is nothing to check.
  assert.deepEqual(boyd.warnings, []);

  const redacted = await parse('ironhub-quote-redacted-2026-03.pdf');
  assert.ok(redacted.warnings.length > 0, 'an unreadable price must reach the user');
  assert.doesNotMatch(redacted.warnings.join(' '), /Legacy strategy|Strategy:/);
});
