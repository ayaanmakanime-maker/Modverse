/**
 * Feature switches read on the server.
 * The live-camera trial room is hidden from customers for now (the owner asked to park it). Its code, tests and
 * route are kept; set MODVERSE_LIVE_TRYON=true to bring it back at /try-on/live.
 */
export const liveTryOnEnabled = () => process.env.MODVERSE_LIVE_TRYON === "true";
