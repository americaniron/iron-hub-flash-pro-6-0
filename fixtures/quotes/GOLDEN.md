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
