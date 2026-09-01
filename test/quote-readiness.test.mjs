/**
 * The blank-part-number gate.
 *
 * The parser deliberately keeps a line item whose part number the source document never printed,
 * rather than inventing one or dropping a real charge.  These tests pin the other half of that
 * bargain: such a quote must not be able to leave the app.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadModule, repoRoot } from './support/harness.mjs';

const readiness = await loadModule('services/quoteReadiness.ts');

const complete = [{ qty: 1, partNo: '539-0546', desc: 'Gasket Kit', weight: 0, unitPrice: 10 }];
const incomplete = [
  { qty: 1, partNo: '539-0546', desc: 'Gasket Kit', weight: 0, unitPrice: 10 },
  { qty: 1, partNo: '', desc: 'HYDRAULIC CONTROL VALVE', weight: 0, unitPrice: 24.46, lineNo: '02' },
];

test('a quote with every part number filled in is clear to leave', () => {
  assert.equal(readiness.quoteReadinessError(complete, 'sent'), null);
  assert.equal(readiness.itemsMissingPartNumbers(complete).length, 0);
});

test('a blank part number blocks the quote and the message names the line', () => {
  const error = readiness.quoteReadinessError(incomplete, 'sent');
  assert.ok(error);
  assert.match(error, /1 line item has no part number/);
  assert.match(error, /02/);
  assert.match(error, /before this quote can be sent/);
});

test('whitespace is not a part number', () => {
  assert.equal(readiness.itemsMissingPartNumbers([{ partNo: '   ' }]).length, 1);
});

test('the archived-quote form reads through the saved payload', () => {
  assert.equal(readiness.savedQuoteReadinessError({ payload: { items: complete } }, 'synced'), null);
  assert.ok(readiness.savedQuoteReadinessError({ payload: { items: incomplete } }, 'synced'));
  // A malformed archive must not throw on the way to the bridge.
  assert.equal(readiness.savedQuoteReadinessError({}, 'synced'), null);
});

test('every customer-facing exit point is gated, not just the import warning', () => {
  const app = fs.readFileSync(path.join(repoRoot, 'App.tsx'), 'utf8');
  const bridge = fs.readFileSync(path.join(repoRoot, 'services/bridgeSync.ts'), 'utf8');
  const exports_ = fs.readFileSync(path.join(repoRoot, 'services/exportService.ts'), 'utf8');

  // PDF generation is the choke point for both WhatsApp and the email module.
  assert.match(app, /const generatePdf[\s\S]{0,320}quoteReadinessError\(items, 'exported as a PDF'\)/);
  assert.match(app, /quoteReadinessError\(items, 'printed'\)/);
  assert.match(app, /quoteReadinessError\(items, 'synced to IronSuite'\)/);
  assert.match(app, /quoteReadinessError\(items, 'converted to an invoice'\)/);
  assert.match(app, /quoteReadinessError\(items, 'sent to a customer'\)/);
  assert.match(bridge, /savedQuoteReadinessError\(quote, 'synced to IronSuite'\)/);
  assert.match(exports_, /savedQuoteReadinessError\(quote, 'exported to IronSuite'\)/);
});
