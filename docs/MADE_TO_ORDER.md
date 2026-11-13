# Made to order: every collection style in the Men and Women ranges

The downloaded 3D collection (`public/garment-library`, 120 garments) is sold made to order. Each piece is a **fixed style** — the creator's 3D model is the visual reference — cut by the workshop from a graded pattern of that style. Customers can only choose what a made-to-order shirt / tailoring workshop actually changes on a single piece; everything else is rejected on the client and again on the server.

## Where it appears
* `/shop/men`, `/shop/women`: one catalogue. Made-to-order styles and the design-your-own models share the grid, type chips (`?cat=`), search, price filters and sort. Unisex pieces appear in both ranges. Site search and the wishlist include them.
* `/shop/<range>/<id>`: the style's page — 3D preview (the creator's model), price from, lead time, what can be changed, wishlist, and **Customise in Design Studio / Atelier / Atelier Pro** plus **Try it on the mannequin**. There is no separate customisation panel on this page any more.
* **The design studio for every style** (`/design/garment/new?garment=<id>&mode=studio|atelier|pro`, saved designs at `/design/garment/<id>`): the same three modes as the T-shirt and shirt editor, a tool rail (Colour, Size & fit, Artwork, Details, Order), undo / redo, the 3D view, the print areas in 2D (drag to move, corner to resize) or both side by side. Design Studio offers colour, size, fit and artwork; Atelier adds fabric, alterations and trims; Atelier Pro adds monogram, made to measure, the full price breakdown, 3D export and Human Studio. Designs save to the account (`garment_designs`, migration 0014, `/api/garment-designs`), are listed under My designs, and add to the cart from the studio. The link can carry `size`, `fabric`, `colour` and `fit` (Human Studio's "Customise & order" uses it).
* `/design/new` lists every shop style next to the design-your-own T-shirts and shirts.
* `/collection` and `/collection/<id>` permanently redirect to the shop (old links keep working).
* The cart has **Try on** on every line.

## What can be chosen (`src/lib/garment/made-to-order.ts`)
| Option | Rule |
|---|---|
| Fabric | Stocked qualities per category (e.g. shirts: poplin 2/40s, Oxford, linen; suits: poly-viscose, wool blend, linen; trousers: stretch twill, suiting, linen, 12 oz denim), with composition, GSM and surcharge |
| Colour | That fabric's colour card only |
| Size | The size chart (XS–3XL men, XS–XXL women); trousers and skirts size by waist and hip |
| Made to measure | From a saved measurement profile, woven styles only (+₹450). Knits (tees, tops, knitwear, hoodies) are graded sizes only |
| Fit | Slim / regular / relaxed where the style allows (suits: slim / regular; hoodies, knitwear: regular / relaxed) |
| Length / sleeve | Small pattern alterations, e.g. shirts ±4 cm body / ±3 cm sleeve, dresses ±8 cm hem, trousers ±6 cm leg; no sleeve alteration on sleeveless styles |
| Trims | Shirts: buttons, collar stays · suits: buttons, lining · trousers: belt loops or side adjusters · dresses / skirts: lining · hoodies: drawcord |
| Monogram | Shirts, blouses (cuff, chest, collar band), suits (inside the jacket): 1–12 letters / numbers, 6 thread colours |
| Artwork | Up to two placements with maximum sizes per style (knits: front / back 30 × 40 cm, left chest 10 × 10, sleeve 8 × 12; woven: left chest 8 × 8; suits, trousers and skirts: none). Methods follow the fabric: DTG / DTF / screen on cotton knits and fleece, DTF + embroidery on poplin, embroidery only on Oxford, linen, crepe, wool and denim. Embroidery ≤ 150 cm² |

Prices: category base + fabric + plus size + made to measure + trims + monogram + decoration, computed with the shop's admin pricing rules (GST threshold and rates, decoration rates, monogram, plus-size surcharge). Labelled illustrative until supplier rates are set. Lead times per category (e.g. tees 5–7, shirts 7–10, suits 18–25 working days after production approval).

## Order flow
* **Cart** (`cart_items.kind = "library"`, options in `cart_items.library`; migration `0010`, additive): re-validated and re-priced on every read; a line that no longer meets the rules (e.g. the garment was switched off) blocks checkout with a clear message. The customer's measurement profile and artwork uploads are checked for ownership on the server.
* **Checkout** snapshots `{ garment, options }` on `order_items` (`kind = "library"`) with a production sheet (style, HSN, fabric, colour, size / measurements, alterations, trims, monogram, artwork, lead time, checks) and the itemised price. Payment, design validation, production approval and status flow are the same as for designs.
* **Admin** order page shows the production details; approval, manufacturer assignment, quotes, QC and shipment booking work unchanged.
* **Manufacturers** declare the garment types they make (now including tops, blouses, knitwear, hoodies, suits, dresses, jumpsuits, trousers and skirts). Matching checks type, range, fabric construction and decoration methods (monograms need embroidery). Jobs show the production sheet without retail prices or customer contact data; the "Production tech pack (PDF)" is a one-page made-to-order sheet. Artwork files are downloadable by the assigned manufacturer only.
* **Logistics** partners receive the delivery address only, as before.
* **Reorder** re-adds the item with today's catalogue and rules; **Redesign** is not offered (the piece is re-customised on its product page).

## Not included
* No graded sewing patterns ship with the 3D models: the workshop's own pattern for each style is assumed. The 3D model is not deformed by fit / length options.
* Supplier rates, fabric stock levels and lead times are illustrative defaults.
