# CLAUDE.md — Quotation App

## What this is

A web app that lets a sanitaryware sales manager build customer quotations by
photographing showroom price tags on his phone. Output is an Excel file with product
images embedded.

**The end user is my father.** He is not technical. He will not open Terminal, will not
read error logs, and will not troubleshoot. Every screen must work first time or he
stops using it.

## The flow

```
1. Set the area (e.g. Master Bath > Water Closet Area)  — set ONCE, stays sticky
2. Photograph a price tag
3. Gemini reads the SKU from the photo
4. Look it up in the catalogue, show a confirmation card
5. He confirms → line added
6. Repeat, changing area only when he walks to the next room
7. Export → .xlsx with images, grouped by area, with subtotals
```

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router, TypeScript) |
| Hosting | Vercel |
| Tag reading | Google Gemini via server route only. SDK: `@google/genai` (`@google/generative-ai` is deprecated). Model: `gemini-3.1-flash-lite` (`gemini-2.5-flash-lite` returns 404 for new API keys). |
| Catalogue + images | Cloudflare R2 |
| Excel generation | ExcelJS, server-side, Node runtime |
| Client state | localStorage |

Env vars: `GEMINI_API_KEY`, `R2_ACCOUNT_ENDPOINT`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`, `ADMIN_PASSWORD`,
`SESSION_SECRET` (HMAC key for signing the admin session cookie — a random
secret, not a password; set a different value per environment),
`NEXT_PUBLIC_R2_PUBLIC_URL` (same value as `R2_PUBLIC_URL`, exposed to the
browser — not a secret, every product image URL already reveals it)

## Decisions already made — do not change these without asking

**Images live on R2, not in the repo.** The product library is 237MB. Bundling it makes
deploys unusable and makes self-service updates impossible.

**products.json lives on R2 at `catalog/products.json`, not in the project.** This is
what allows my father to update the catalogue himself. Anything in the repo is read-only
at runtime.

**The 237MB file must never be sent to a server.** Vercel functions cap request bodies at
4.5MB. The admin page unzips and processes the file in the browser, then uploads images
directly to R2 using presigned URLs.

**Use fflate, not JSZip**, for browser-side unzipping. JSZip has known out-of-memory
failures on large files.

**Browser-side parsing runs in a Web Worker.** Without it the page freezes and he assumes
it has crashed.

**Excel export must embed real images.** This is the entire reason this is a built app
rather than a spreadsheet. If images stop appearing in the export, that is a P0 bug.

## Price calculation — do not alter

```
net unit price = LIST PRICE × (1 − discount / 100)
line total     = net unit price × qty
```

- Discount is entered by my father per item. It is never read from the database.
- The QTY column in the source spreadsheet is IGNORED completely.
- Bundle/package pricing is handled by him manually afterwards. List items individually.

## Source file structure — verified by inspection, do not re-guess

`Quotation items Library.xlsx` — 237MB, **67 sheets**, one per brand or product line.

- 65 real product sheets. **Skip `EMPTY` and `Sheet1`.**
- ~2,300 line items, **1,981 distinct SKUs**
- **3,833 image files, ~4,809 anchors** — about 215 images are reused across several
  products. Upload each unique file to R2 once and reference it from all of them.
- 22 grouped shapes contain multiple images — extract all of them.

### Six layout variants exist. Never hardcode column positions.

| Variant | Sheets | What differs |
|---|---|---|
| A | 55 | Standard: NO / ITEM CODE / IMAGE / ITEM DESCRIPTIONS / DIMENSION / QTY / PACKAGE UNIT PRICE / TOTAL |
| B | 2 | Same as A **plus a trailing LIST PRICE column** |
| C | 5 | Same as A but the `NO` header cell is **blank** |
| D | 3 | **Header is on row 2**, row 1 is a title banner |
| E | 1 (ROMAN) | ITEM DESCRIPTIONS and DIMENSION **merged into one column** |

Detect the header row by scanning the first 3 rows for one containing at least two of:
IMAGE, ITEM DESCRIPTIONS, DIMENSION, QTY, TOTAL, or any header containing PRICE.

### The price column has three different names

- `PACKAGE/ UNIT PRICE (RM)` — 62 sheets
- `LIST PRICE` — GROHE BLUE LIST
- `DISCOUNTED PRICE (RM)` — GROHE CERAMICS (2)

Match loosely: any header containing "PRICE" but not "TOTAL".
**If a sheet has two price columns (variant B), use PACKAGE/ UNIT PRICE** — that is the
figure that appears on real quotations.

### Row rule

Import a row only if it has a non-empty ITEM CODE. That single rule correctly skips
section-divider banners, trailing blank rows, and the AIREGARD "optional service" rows
which have prices but no SKU.

### GROHE PACKAGES

Bundle sheet. Component SKUs sit under vertically merged price cells holding one combined
package price. **Never copy that merged price into each component row.** Set those to
`price: null, priceMissing: true` and let a version from another sheet win during dedupe.

### Duplicates — 128 SKUs, 40 with conflicting prices

Dedupe to one entry per SKU across the whole file. Preference:
1. Real price beats null
2. Has image beats no image
3. Conflicting real prices → **take the higher one**, and log it to `conflicts.csv`

Higher wins because quoting slightly high is recoverable in negotiation; quoting too low
costs real money. Every conflict must still be reported, never silently resolved.

### Junk to ignore

- `QTY` column contains text like "P", "C", "p" — ignore the column entirely
- `TOTAL` column contains `#VALUE!` errors and stray text like "OPTION" — never parse it
- Vertical merges in the `NO` column are cosmetic only

## SKU matching rules

- Case-insensitive, spaces removed
- **Dashes are significant.** `LS-5500-BN` and `LS-5500TZ` are different products.
- Exact match first, then a loose match that also strips dashes/dots/underscores
- Never fuzzy-match or "nearest neighbour" a SKU. Wrong product = wrong price on a real
  customer quotation. If it is not found, say so and let him search or type it manually.

## UX rules that must not be simplified away

These are deliberate. `quote-builder.jsx` in this repo is the reference prototype.

- **Sticky area/sub-area.** He sets the location once and every scan goes there. He must
  never retype the area per item.
- **Qty and discount persist between scans** as defaults.
- **Confirmation card before adding anything.** Never add blindly from a photo.
- **Duplicate SKU in the same sub-area** offers to merge quantities.
- **Not-found has three escapes**: type the code, search by keyword, or insert a blank
  line. Never only "retake photo".
- **Undo on delete.**
- **Autosave on every change.** His phone will lock mid-quotation. He must lose nothing.
- **Running totals** for the current location and the whole quotation.

## Mobile rules

Used one-handed on an iPhone in a showroom.

- Inputs minimum 16px font or Safari zooms on focus
- Touch targets minimum 44px
- Primary capture button in the lower half of the screen
- Must be correct at 390px wide

## Security

- API keys and R2 credentials never reach the browser
- Presigned URLs scoped to a single object key, short expiry
- No separate `/admin` route — one URL for everyone. Admin (catalogue
  management) is a login gate inside the same app: "Login as admin" in the
  header, unlocked sections in Setup. Credentials live on R2 at
  `config/admin.json` (bcrypt-hashed), verified server-side on every
  admin route via a signed httpOnly session cookie (`lib/session.ts`,
  `lib/admin-auth.ts`) — the UI hiding a button is never the actual gate.
  `ADMIN_PASSWORD` always works as a master-password recovery fallback
  alongside whatever username/password are set in Setup. Logins are
  rate-limited (5 failed attempts locks a client for 15 minutes).

## How to work with me

- I am building this with Claude Code but I am not a professional developer. Explain
  problems in plain English, not stack traces.
- **Ask before assuming.** If something about the data or the pricing is unclear, stop
  and ask. A wrong assumption here means wrong prices on real customer quotations.
- When something fails, tell me what broke and what you changed. Do not quietly work
  around it.
- Prefer fewer moving parts over clever solutions. This has to keep working when I am
  back at university and not available to fix it.