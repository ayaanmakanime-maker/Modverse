# Dynamic pricing (V2)

`src/lib/garment/pricing.ts` (pure, unit-tested) · server rules `src/lib/services/pricing.ts` · admin UI **Admin → Pricing & discounts** (`/admin/pricing`).

> **Illustrative until verified.** All costs are configurable estimates. Prices carry an "illustrative pricing" label until an admin switches it off after connecting verified supplier rates. GST rates must be confirmed with a tax advisor.

## Model
```
unit price = model base price (retail, × kids factor)
           + Σ material      components  (cost × material margin)
           + Σ construction  components  (cost × construction margin)
           + Σ decoration    components  (cost × decoration margin)
GST        = unit price × (low rate if ≤ threshold else high rate)
cart       = Σ lines − discount (allocated across lines, GST on the discounted value) + shipping
```
Every component is an itemised line with a category, a customer-readable detail and its estimated manufacturing cost.

| Category | Components |
|---|---|
| Base | garment model base price (includes base fabric and base construction), plus-size surcharge |
| Material | fabric premium (fabric catalogue), GSM above/below the fabric default (per 20 GSM), **fabric consumption difference** vs the model's own proportions at the same size (from actual panel outline areas + 12 % seam allowance + 18 % marker wastage, × fabric cost/m² by category) |
| Construction | extra pockets, henley placket, French / convertible cuffs, contrast stitching, western yoke, back pleat, darts, side/shoulder panels, side slits, monogram, premium buttons, extra buttons, custom proportions, contrast panel colours, panel fabrics, all-over pattern panels |
| Decoration | per placement & method: printed **area** × rate (≥ minimum), **setup per placement**, screen printing **per colour** (real artwork colours; conservative 4 when unknown), embroidery from an **estimated stitch count** (fill coverage × stitches/cm² + underlay) × rate per 1,000 stitches (≥ minimum) plus digitising per placement |

## Rules that keep prices honest (tested)
* Moving or rotating artwork within a surface **never** changes the price; editing text content doesn't either.
* Scaling artwork, adding colours, adding stitches, adding a placement on another surface, or changing construction does — because manufacturing cost changes.
* Ordinary edits add no surcharge.
* The server recomputes every price (cart reads, checkout, order snapshot). Checkout receives the total the customer saw and returns **409 `price_changed`** if the server total differs (e.g. rules changed), so nobody is charged a silently different amount.
* Order items store a **price snapshot** (itemised breakdown, rules version, placements) — later rule changes never alter past orders.

## Configuration (admin)
Margins per category · GST low/high rate and threshold · shipping flat rate and free-shipping threshold · kids factor · plus-size surcharge · fabric cost per m² by category · GSM step cost · consumption threshold · construction cost table · decoration per-cm², minimum and setup per method · screen cost per colour · embroidery cost per 1,000 stitches and stitch density · illustrative label. A live preview shows example designs before and after changes; changes are audited and can be reset to defaults. Stored as the `pricing` platform setting (versioned, Zod-validated; V1 values fall back to defaults; the legacy `shipping` setting is honoured until v2 rules are saved).

## Discounts
`discount_codes` (migration 0003): percent (≤ 90 %) or fixed, minimum subtotal, maximum discount, start/end dates, total usage limit, per-customer limit, active flag. Codes are validated when applied to the cart and again at every cart read and at checkout (expired / not yet active / minimum not met / limit reached / already used). Orders store `discount` and `discount_code`.

## Where prices appear
Editor (top bar, Check & order → itemised breakdown; uses the admin rules via `GET /api/pricing/rules` and the real artwork colours), tech pack panel and PDF (price table + estimated customisation cost), The Muse transaction preview (price before → after), cart (per-line breakdown, discount, shipping rule), checkout, order page.
