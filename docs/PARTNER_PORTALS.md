# Manufacturer & logistics portals (V2)

Status: **Locally implemented** — every workflow below runs end-to-end in the local app and is covered by tests. Courier booking is **Simulated** (AWBs and labels are ModVerse-issued until a courier API is connected — see "Not yet connected").

Code: `src/lib/services/partners.ts` (all rules and access checks) · `src/lib/partners/constants.ts` (shared states) · `src/components/partners/*` (portal UI) · `src/components/admin/AdminPartners.tsx` (admin UI) · migration `drizzle/0004_v2_partner_portals.sql` (additive only).

## Who sees what
| | Customer | Manufacturer member | Logistics member | Staff | Admin |
|---|---|---|---|---|---|
| Own orders, production stage, tracking, own disputes | ✓ | — | — | ✓ | ✓ |
| Jobs assigned to **their organisation**: design snapshot, spec, placements, quantity, production tech pack | — | ✓ | — | ✓ | ✓ |
| Customer artwork used by an **active** job of their organisation | — | ✓ | — | ✓ | ✓ |
| Shipments assigned to **their organisation**: delivery address, phone, units, weight, COD amount | — | — | ✓ | ✓ | ✓ |
| Retail prices, customer email, other organisations' work | — | ✗ | ✗ | ✓ | ✓ |
| Approve partners, approve quotations | — | — | — | — | ✓ |
| Assign/reassign, create shipments, rework, disputes | — | — | — | ✓ | ✓ |

**Organisation isolation** — every partner call resolves the caller's *approved* organisation (`requirePartner`) and filters by its id. Another organisation's job or shipment returns **404** (indistinguishable from "doesn't exist"); the wrong partner type returns **403**; pending/suspended/rejected organisations are refused immediately (`partner_pending` / `partner_inactive`). File access (`partnerCanReadUpload`) is granted only for production photos and POD photos on the organisation's own records, and for customer artwork referenced by an order whose job for that organisation is still active — a cancelled or reassigned job loses access at once. Manufacturer job views and the production tech pack PDF omit retail prices and customer contact details; logistics views omit designs and prices. Partner names never appear on the customer's timeline (assignment notes and partner disputes are staff-only events). `tests/integration/partners.test.ts` asserts each of these.

## Onboarding
1. A signed-in user applies at **/partners** as a manufacturer or logistics company: business details, optional GSTIN (format-validated), and capabilities —
   * manufacturer: decoration methods, garment types, audiences, knit/woven, minimum order, daily capacity, lead time, certifications (self-declared);
   * logistics: couriers booked, service states, COD, express, maximum parcel weight.
2. The application is **pending** until an admin approves it at **Admin → Partners** (approve / reject / suspend / reinstate — all audited).
3. The owner can edit capabilities and add teammates (existing ModVerse accounts) at **/partner/organisation**. A user belongs to at most one organisation.

## Manufacturing workflow
```
paid order ─ staff approves every item ─ staff assigns manufacturer (capability check; mismatch needs explicit override)
  offered ──accept──▶ accepted ──quote──▶ quoted ──admin approves──▶ quote_approved ──stage──▶ in_production
     │                    ▲                 │ admin rejects → accepted (re-quote)                │
     └─decline (reason)   └─────────────────┘                                    QC fail → rework ─┤
                                                                                  QC pass → qc_passed ─ready──▶ ready_to_dispatch ─pickup──▶ dispatched
```
* Reassigning cancels the previous active job (its access ends) and creates a new offer.
* Stages: cutting, printing, embroidery, sewing, finishing, pressing, packing.
* Issues (low/medium/high) can be reported and resolved at any time; open issues and overdue jobs are flagged on **Admin → Production**.
* QC reports carry a checklist, sample size and defects; a "pass" with a failed check is rejected. A fail moves the job to rework; staff can also request rework.
* Production photos are stored as private uploads.
* Order status advances automatically and **only forward**: quote approved → `manufacturing`, QC pass → `quality_inspection`, ready → `packed`, pickup → `shipped`, delivery → `delivered` (`progressOrder` in `commerce.ts`).
* **Production tech pack**: `/api/partner/jobs/:id/techpack?item=` renders the tech pack from the immutable order snapshot, marked PRODUCTION COPY with order number, quantity and size, without retail prices.

## Logistics workflow
```
staff creates shipment (approved partner, courier from its list, COD only if supported)
assigned ─label─▶ label_created ─▶ pickup_scheduled ─▶ picked_up ─▶ in_transit ─▶ out_for_delivery ─▶ delivered (POD required)
                                                                                     └─▶ failed_delivery (reason) ─▶ out_for_delivery | rto_initiated ─▶ returned
```
* Labels: 4×6 in PDF with AWB, addresses, units, weight, COD amount (`src/lib/shipping-label-pdf.ts`). The stripe pattern is visual only — **not a carrier-certified barcode**.
* Pickup scheduling stores a date and window. Every update is appended to the shipment's event log (location, note, reason) and to the order timeline.
* Proof of delivery: receiver name and/or POD photo; delivery is refused without one.
* Return shipments (for shipped/delivered orders) run customer → returns facility and never move the order backwards.
* Staff can reassign a shipment to another partner/courier until pickup (the AWB is re-issued).

## Disputes
Customers (order page → "Report a problem") and partners involved in the order (job or shipment page) can raise disputes: quality, delay, damage, delivery, payment, other. Anyone else gets 404. Staff manage them at **Admin → Disputes** (investigate / resolve / reject with a written resolution). Customers see the resolution of their own disputes.

## Admin pages
**Partners** (approval) · **Production** (board: status, stage, due/overdue, open issues, last QC, pending quotation approve/reject, rework) · **Shipping** (open/exceptions, reassign) · **Disputes** · **Order detail → Manufacturing & logistics partners** (assign/reassign with capability match, quotations, job events & photos, create forward/return shipments, shipment events).

## API
Partner (`auth: user`, organisation-scoped): `GET/PATCH /api/partner/me`, `POST /api/partner/apply`, `GET/POST /api/partner/members`, `GET /api/partner/jobs`, `GET/POST /api/partner/jobs/:id` (`accept|reject|quote|stage|issue|resolve_issue|qc|ready`), `POST /api/partner/jobs/:id/photos`, `GET /api/partner/jobs/:id/techpack`, `GET /api/partner/shipments`, `GET/POST /api/partner/shipments/:id` (`label|track`), `GET /api/partner/shipments/:id/label`, `POST /api/partner/shipments/:id/pod`, `GET/POST /api/disputes`.
Admin: `GET /api/admin/partners`, `PATCH /api/admin/partners/:id` (admin), `GET /api/admin/production`, `POST /api/admin/production/:id`, `POST /api/admin/quotations/:id` (admin), `GET/POST /api/admin/orders/:id/fulfilment`, `GET /api/admin/shipments`, `PATCH /api/admin/shipments/:id`, `GET /api/admin/disputes`, `PATCH /api/admin/disputes/:id`.
All writes are rate-limited, CSRF-protected by the origin middleware, validated with Zod and audited.

## Not yet connected
| Capability | Status |
|---|---|
| Courier APIs (Shiprocket, Delhivery, …): real AWB, rates, pickup booking, tracking webhooks | **Awaiting credentials** — the portal workflow is the integration point; today AWBs/labels are ModVerse-issued (**Simulated**) |
| Partner payouts / invoices against approved quotations | **Not implemented** (quotation amounts are recorded for reconciliation) |
| Partner email/SMS notifications | **Not implemented** — partners see new work on their dashboards; every event is on the job/shipment and order timelines |
| Self-service partner sign-up verification (GSTIN lookup, KYC) | **Not implemented** — admins verify manually before approving |
