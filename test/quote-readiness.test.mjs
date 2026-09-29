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

  // One gate, called everywhere, so a new exit point cannot skip the checks by omission.
  assert.match(app, /const ensureQuoteMayLeave = useCallback/);
  assert.match(app, /const blocked = quoteReadinessError\(items, action\);\s*\n\s*if \(blocked\) \{ alert\(blocked\); return false; \}/);
  // PDF generation is the choke point for both WhatsApp and the email module.
  assert.match(app, /const generatePdf[\s\S]{0,400}ensureQuoteMayLeave\('exported as a PDF'\)/);
  assert.match(bridge, /savedQuoteReadinessError\(quote, 'synced to IronSuite'\)/);
  assert.match(exports_, /savedQuoteReadinessError\(quote, 'exported to IronSuite'\)/);
});

// --------------------------------------------------------------------------------------------
// Draft status
// --------------------------------------------------------------------------------------------

test('a blank part number makes the quote a draft; a complete one is ready', () => {
  assert.equal(readiness.quoteStatusFor(complete), 'ready');
  assert.equal(readiness.quoteStatusFor(incomplete), 'draft');
});

test('an archive written before `status` existed is judged by its items', () => {
  // Quotes saved by an older build have no status field.  They must not be silently treated as
  // ready if they in fact carry a blank part number.
  assert.equal(readiness.isDraftQuote({ payload: { items: incomplete } }), true);
  assert.equal(readiness.isDraftQuote({ payload: { items: complete } }), false);
  assert.equal(readiness.isDraftQuote({ status: 'draft', payload: { items: complete } }), true);
  assert.equal(readiness.isDraftQuote(null), false);
});

test('drafts are held out of everything that leaves, at one chokepoint', () => {
  const db = fs.readFileSync(path.join(repoRoot, 'services/dbService.ts'), 'utf8');
  // Every quote write goes through setData, so filtering there covers Save to Archive, the bulk
  // bridge push, and any future caller.
  assert.match(db, /function withoutDraftQuotes/);
  assert.match(db, /serverSet\(username, storeName, withoutDraftQuotes\(storeName, data\)\)/);
  // The local cache still keeps them, or saving a draft would lose the work.
  assert.match(db, /localSet\(storeName, username, data\)/);
});

test('a draft still saves, and is stamped rather than refused', () => {
  const app = fs.readFileSync(path.join(repoRoot, 'App.tsx'), 'utf8');
  // Save to Archive runs the send-gate only for a ready quote; a draft saves regardless.
  assert.match(app, /const status = quoteStatusFor\(items\);\s*\n\s*if \(status === 'ready' && !ensureQuoteMayLeave\('synced to IronSuite'\)\) return false;/);
  assert.match(app, /status === 'draft'[\s\S]{0,200}Saved to Archive as a DRAFT/);
  // The local JSON file carries the status too, so a round trip cannot launder the blank.
  assert.match(app, /const data = \{ version: '2\.5', status, reconciliationAck,/);
});

test('reopening a draft lands on the field that has to be fixed', () => {
  const app = fs.readFileSync(path.join(repoRoot, 'App.tsx'), 'utf8');
  const editor = fs.readFileSync(path.join(repoRoot, 'components/ItemEditor.tsx'), 'utf8');
  assert.match(app, /querySelector<HTMLInputElement>\('\[data-partno-blank="true"\]'\)/);
  assert.match(app, /blank\.focus\(\)/);
  assert.match(editor, /data-partno-blank=\{!item\.partNo\.trim\(\) \? 'true' : undefined\}/);
});

// --------------------------------------------------------------------------------------------
// Reconciliation acknowledgement
// --------------------------------------------------------------------------------------------

const figures = { itemsTotal: 100, subtotal: 120, shipping: 0, tax: 0, total: 120 };

test('an acknowledgement covers only the exact figures it was given', () => {
  const fingerprint = readiness.reconciliationFingerprint(complete, figures);
  const ack = { by: 'adam', at: new Date().toISOString(), fingerprint, gap: -20 };
  assert.equal(readiness.acknowledgementCovers(ack, fingerprint), true);
  assert.equal(readiness.acknowledgementCovers(null, fingerprint), false);
});

test('changing a price invalidates an existing acknowledgement', () => {
  const before = readiness.reconciliationFingerprint(complete, figures);
  const repriced = [{ ...complete[0], unitPrice: 11 }];
  const after = readiness.reconciliationFingerprint(repriced, figures);
  assert.notEqual(before, after);
  assert.equal(readiness.acknowledgementCovers({ fingerprint: before }, after), false);
});

test('changing a quantity, a line, or a printed total also invalidates it', () => {
  const base = readiness.reconciliationFingerprint(complete, figures);
  assert.notEqual(readiness.reconciliationFingerprint([{ ...complete[0], qty: 2 }], figures), base);
  assert.notEqual(readiness.reconciliationFingerprint([...complete, ...complete], figures), base);
  assert.notEqual(readiness.reconciliationFingerprint(complete, { ...figures, total: 130 }), base);
  assert.notEqual(readiness.reconciliationFingerprint(complete, { ...figures, shipping: 5 }), base);
  // Identical input must give an identical fingerprint, or every send would re-prompt.
  assert.equal(readiness.reconciliationFingerprint(complete, figures), base);
});

test('the prompt states the real figures, not a generic message', () => {
  const prompt = readiness.formatReconciliationPrompt(figures, 'sent to a customer');
  assert.match(prompt, /Line items total:\s+100\.00/);
  assert.match(prompt, /Printed subtotal:\s+120\.00/);
  assert.match(prompt, /Printed total:\s+120\.00/);
  assert.match(prompt, /Gap:\s+-20\.00/);
  assert.match(prompt, /sent to a customer/);
  assert.doesNotMatch(prompt, /totals do not match/i);
});

test('the acknowledgement is per quote, recorded with who and when, and gates every exit', () => {
  const app = fs.readFileSync(path.join(repoRoot, 'App.tsx'), 'utf8');
  // Recorded against the quote, not a global flag or a session preference.
  assert.match(app, /setReconciliationAck\(\{\s*by: user\?\.username[\s\S]{0,120}fingerprint,[\s\S]{0,40}gap,/);
  assert.match(app, /reconciliationAck: reconciliationAck \?\? undefined/);
  // A fresh import clears any prior acknowledgement.
  assert.match(app, /setReconciliationAck\(null\);\s*\n\s*handleDataLoaded/);
  // Reopening an archived quote restores its own.
  assert.match(app, /setReconciliationAck\(archive\.reconciliationAck \?\? null\)/);
  // Every exit point runs the one gate that performs both checks.
  for (const action of [
    "'exported as a PDF'", "'printed'", "'synced to IronSuite'",
    "'converted to an invoice'", "'sent to a customer'", "'exported as a quote file'",
  ]) {
    assert.match(app, new RegExp(`ensureQuoteMayLeave\\(${action}\\)`), `${action} is not gated`);
  }
});
