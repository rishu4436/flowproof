# Demo guide

Start Postgres, then `pnpm dev`. Open http://127.0.0.1:3000. The portal is http://127.0.0.1:4100. Demo data is synthetic.

## Normal submission

Demo Lab → scenario A → Start test run, or open the Vendor invoice submission workflow and run it with:

- Invoice `INV-2041`
- Vendor `Northstar Supplies`
- PO `PO-991`
- Amount `2450.00`
- Currency `USD`
- Terms `Net 30`

The worker opens Chromium, fills the Northstar form, and submits. Verification reads `GET /api/verify/invoices?idempotencyKey=...` with the portal verify token. A matching record becomes `VERIFIED`.

Observed run: `run_425a22085217b086a7efe67b`.

## Changed interface

Scenario B changes the submit button to “Send to accounts”. The stored step still looks for “Submit invoice”, so that step fails. The authorized semantic names include “Send to accounts”. With Otari unset, the repair source is `deterministic`. The business values are not changed.

Observed run: `run_b84eca55d199532e11ede86c`, receipt `VERIFIED`, one recovery with result `applied`.

Turn off “Auto-approve safe locator repairs” in Settings if you want that repair to pause for approval.

## False success

Scenario E renders “Invoice submitted successfully” and does not insert a row. FlowProof’s authoritative check returns not found. The receipt decision is `FAILED`. The explanation stored on the observed run was: “The page reported success, but the authoritative record did not match. The success message is not treated as proof.”

Observed run: `run_acca589a61eba17ff0ed3955`.

## Uncertain write

Scenario G inserts the invoice and then drops the socket. The worker marks the write as started before the click and does not click again. Verification reads the record back. If the read matches, the receipt is `VERIFIED` and notes that the browser response was lost. If the read cannot be completed, the decision is `OUTCOME_UNKNOWN`.

## Model comparison

The Benchmark Lab can run the same scenarios with the FlowProof worker. A second Otari model is used only when a repair or review model is configured and the key is present. With no key, the Models page stays `not_configured` and no second model is fabricated.
