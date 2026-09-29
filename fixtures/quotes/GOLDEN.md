# Golden snapshots — before and after the layout-driven parser

Captured with `test/support/harness.mjs`, which runs the real `services/parserService.ts` under
Node. "Before" is the parser at tag `pre-layout-parser-20260901` (commit `3f9c0485`), the state
deployed on 2026-09-01. Images are stubbed out in both runs so the two are comparable.

Reproduce the "after" column with:

    node --test test/parser-fixtures.test.mjs

Every diff below is a fix. None is a behaviour change that lost information.

| Fixture | Before | After | Why the diff is a fix |
|---|---|---|---|
| `cat-partscatcom-2026-09.pdf` | throws "No items detected in source" | `539-0546` · Transmission Gasket Kit · 1 × $2,086.82 | The reported bug. The Parts.Cat.Com header has no `part` token, which the old table parser required. |
| `cat-partscatcom-boyd-2026-08.pdf` | 6 items: `ONLINE25`, a promotion blurb, `Payment Information`, `BILLING METHOD`, `Billing Address`, `SUMMARY OF CHARGES` | 1 item: `583-9600` · Engine Cylinder Head · $6,808.54 | Silent corruption. All six "items" were section headings; the document has exactly one line item. |
| `ironhub-invoice-2026-04.pdf` | `HYDRAULIC` / desc `CONTROL VALVE 1 $ 24.46 $` | `""` / desc `HYDRAULIC CONTROL VALVE` | The part-number column on this document is genuinely empty. The old output invented a part number from the first word of the description and left the price text in the description. An honest blank plus a warning is correct; see the note below. |
| `ironhub-quote-imageonly-2026-04.pdf` | throws "No items detected in source" | throws "This PDF has no text layer — every page is an image…" | Same outcome, specific diagnosis. The file is a jsPDF/html2canvas raster with 0 text items and 1 full-page image per page. |
| `ironhub-quote-redacted-2026-03.pdf` | `5 2 . 6 L B S` / desc `GP STATUS 7 D AY S` | `175-6779` / desc `AIR COMPRESSOR 1 CLAYTON (5-) GP`, weight 52.6 | The weight cell was being returned as the part number. Prices on this document are redacted as `xxxxxxxxxx`, so the price is 0 with an explicit "redacted" warning rather than a fabricated number. |
| `ironhub-quote-roundtrip-2026-02.pdf` | 7 items, part numbers `25 LBS`, `6 LBS`, `2.1 LBS`, `20.8 LBS`, `10R-7672`, `1.2 LBS`, `CORE: $148.27`; all unit prices 0 | 5 items: `319-0677`, `366-8821`, `381-2499`, `317-8021`, `10R-7672` with correct unit prices and weights | The document has **five** line items, not seven. Proof: the extended prices sum to `3423.26 + 3639.21 + 942.93 + 4197.50 + 3160.38 = 15,363.28`, exactly the MANIFEST SUBTOTAL the document prints. The old seven were four weight cells, one core-deposit cell and two real numbers. |

## Notes

**The invoice's blank part number.** `validateItems` rejects a bad part number but allows an
absent one when the rest of the line is complete (description plus a price). Dropping the line
would lose a real $24.46 charge; inventing `HYDRAULIC` from the description is what the old
parser did. The item carries a `no part number found` warning.

**Applied offers are never reconciled automatically.** Both Parts.Cat.Com fixtures print a
discount that is not deducted from their own printed total. The total is reported exactly as
printed, the discount is parsed into `summary.appliedOffers`, and the discrepancy is raised as a
warning shown in the Intake Center. Pending a decision on how Iron Hub should treat them.

## Reconciliation (added after review)

Every document that prints a subtotal or total is now cross-checked: the line items' extended
prices are summed, separately-printed charges are added, and a mismatch becomes a `warnings[]`
entry. Nothing is ever adjusted to force a match — a parser that balances its own books hides the
dropped line item this is meant to catch.

| Fixture | items | + charges | printed total | balanced |
|---|---|---|---|---|
| `cat-partscatcom-2026-09.pdf` | 2,086.82 | shipping 0.00 | 2,086.82 | yes |
| `cat-partscatcom-boyd-2026-08.pdf` | 6,808.54 | shipping 208.49, tax 0.00 | 7,017.03 | yes |
| `ironhub-invoice-2026-04.pdf` | 24.46 | — | 24.46 | yes |
| `ironhub-quote-roundtrip-2026-02.pdf` | 15,363.28 | freight 305.50, discount −768.16, credit −10.31, core deposits 889.62 | 15,779.93 | yes |
| `ironhub-quote-redacted-2026-03.pdf` | 0.00 | tax 8,239.67 | 129,757.21 | **no — reported** |

The BOYD $208.49 is the `Shipping/Miscellaneous:` row printed on page 2, not a dropped line item.
The redacted quote genuinely cannot reconcile because its prices are printed as `xxxxxxxxxx`; that
is reported loudly and no figure is invented.

## Item-to-image pairing

Verified rather than assumed, using a canvas shim that preserves image identity
(`test/parser-images.test.mjs`). On the round-trip fixture the old parser paired images
`IMG#2`–`IMG#6` with its five leading items; the new parser pairs **the same five images in the
same order**, now attached to `319-0677`, `366-8821`, `381-2499`, `317-8021`, `10R-7672` instead of
to `25 LBS`, `6 LBS`, `2.1 LBS`, `20.8 LBS`, `10R-7672`. The letterhead (`IMG#1`) stays unattached
in both. The two spurious old items carried no image, so nothing was lost.

One regression was found and fixed while checking this: the first cut of the refactor dropped
image pairing entirely on the legacy-strategy fallback path. Legacy strategies now carry their
anchor coordinates through, and both paths share one association step.

## Applied offers

Parsed into `summary.appliedOffers` for audit and read by nothing else — no warning, no UI, no
pricing. The supplier does not deduct the discount from its own printed total on either fixture,
so whether Caterpillar honours it at invoicing is unconfirmed; on the September order it is
exactly 10.00% of subtotal, and auto-deducting would move real margin on an assumption.

## Draft quotes and acknowledged mismatches (added after second review)

**Draft status.** A quote holding a line item with no part number is stamped `status: 'draft'`
(reusing the word already in `InvoiceData.status` and the IronSuite export's Status column). It
saves and reloads freely — losing imported work would be a worse failure than the blank — but it
is held out of everything that leaves. The guarantee is enforced at one chokepoint,
`dbService.setData`, which strips drafts from the payload sent to the server while keeping them in
the local cache: no quote with a blank part number can reach IronSuite by any route, including
callers not yet written. Drafts show a red DRAFT badge in the archive, the blank field renders
red with a REQUIRED placeholder, and reopening a draft scrolls to and focuses that field.

**Reconciliation acknowledgement.** A quote that does not balance stays sendable, but only after
an explicit per-quote acknowledgement. The prompt states the real figures — items total, each
charge, printed total, and the gap — never a generic message. The acknowledgement records who and
when, is stored on the quote (`reconciliationAck`), and is fingerprinted (FNV-1a) over every
item's part number, quantity, unit price, extended price and core deposit plus all printed totals.
Changing any of those invalidates it, so an acknowledgement of one set of numbers can never carry
over to different numbers. A fresh import clears it; reopening an archived quote restores its own.

Both checks run through a single gate, `ensureQuoteMayLeave`, so a new exit point cannot skip them
by omission.
