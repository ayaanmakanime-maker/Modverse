/** Partner workflow constants shared by the server services and the portal UI (pure, no server imports). */
export const STAGES = ["cutting", "printing", "embroidery", "sewing", "finishing", "pressing", "packing"] as const;
export type ProductionStage = (typeof STAGES)[number];

export const SHIPMENT_FLOW = ["assigned", "label_created", "pickup_scheduled", "picked_up", "in_transit", "out_for_delivery", "delivered"] as const;
export const SHIPMENT_STATUSES = [...SHIPMENT_FLOW, "failed_delivery", "rto_initiated", "returned", "cancelled"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** Allowed tracking transitions (enforced server-side; the UI offers only these). */
export const SHIPMENT_NEXT: Record<string, ShipmentStatus[]> = {
  assigned: ["label_created", "cancelled"],
  label_created: ["pickup_scheduled", "picked_up", "cancelled"],
  pickup_scheduled: ["picked_up", "pickup_scheduled", "cancelled"],
  picked_up: ["in_transit"],
  in_transit: ["out_for_delivery", "in_transit", "delivered"],
  out_for_delivery: ["delivered", "failed_delivery"],
  failed_delivery: ["out_for_delivery", "rto_initiated"],
  rto_initiated: ["returned"],
};

/** Default QC checklist offered to manufacturers (editable per report). */
export const QC_CHECKS = ["Measurements within tolerance", "Artwork placement matches the placement sheet", "Colour matches approved shade", "Print / embroidery quality", "Seams & stitching", "Trims, labels & buttons", "Pressing & packing"] as const;

export const JOB_STATUS_LABEL: Record<string, string> = {
  offered: "New offer", accepted: "Accepted — quote due", rejected: "Declined", quoted: "Quote submitted", quote_approved: "Quote approved", in_production: "In production",
  qc_passed: "QC passed", rework: "Rework", ready_to_dispatch: "Ready to dispatch", dispatched: "Dispatched", cancelled: "Cancelled",
};

export const INDIAN_COURIERS = ["Delhivery", "Blue Dart", "DTDC", "Ecom Express", "Xpressbees", "Shadowfax", "India Post"] as const;
