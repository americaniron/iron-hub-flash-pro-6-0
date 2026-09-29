/**
 * Item-to-image pairing.
 *
 * The refactor changed which row anchors an item, so it could plausibly have changed which
 * extracted image each item receives.  This asserts it did not: the same images, in the same
 * order, now attached to correctly identified parts.  Runs in its own file because it needs a
 * canvas shim that the line-item tests deliberately do without.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileFromPath, installIdentityCanvasShims, repoRoot } from './support/harness.mjs';

installIdentityCanvasShims();
const { loadParserService } = await import('./support/harness.mjs');
const parser = await loadParserService();

const parse = (name) => parser.parsePdfFile(fileFromPath(path.join(repoRoot, 'fixtures/quotes', name)));

test('each item on the round-trip quote keeps its own part photo', async () => {
  const { items } = await parse('ironhub-quote-roundtrip-2026-02.pdf');
  assert.equal(items.length, 5);
  for (const item of items) {
    assert.equal(item.originalImages.length, 1, `${item.partNo} lost its image`);
    assert.match(item.originalImages[0], /^IMG#\d+@\d+x\d+$/);
  }
  // Distinct images, in page order — no item may inherit another's photo.
  const ids = items.map((i) => i.originalImages[0]);
  assert.equal(new Set(ids).size, 5, 'two items share one image');

  // The same five images the previous parser paired, and in the same order.  It attached them
  // to items whose part numbers read "25 LBS", "6 LBS", "2.1 LBS", "20.8 LBS" and "10R-7672";
  // they now land on the five real part numbers instead.
  assert.deepEqual(ids, ['IMG#2@1024x1024', 'IMG#3@1024x1024', 'IMG#4@1024x1024', 'IMG#5@1024x1024', 'IMG#6@1024x1024']);
  assert.deepEqual(
    items.map((i) => i.partNo),
    ['319-0677', '366-8821', '381-2499', '317-8021', '10R-7672'],
  );
});

test('the page logo is not handed to a line item', async () => {
  // IMG#1 is the letterhead. It sits far above the table and must stay unattached.
  const { items } = await parse('ironhub-quote-roundtrip-2026-02.pdf');
  assert.equal(items.some((i) => i.originalImages[0] === 'IMG#1@1024x1024'), false);
});

test('the new Caterpillar format also pairs its part image', async () => {
  const { items } = await parse('cat-partscatcom-2026-09.pdf');
  assert.equal(items.length, 1);
  assert.equal(items[0].originalImages.length, 1);
  assert.match(items[0].originalImages[0], /^IMG#\d+@153x153$/);
});
