// Invoice extraction adapter. THIS IS A MOCK — see the final report for
// this phase. No real OCR/AI service is called; the user explicitly
// asked to defer that decision (which provider, API keys, cost) rather
// than have one silently added.
//
// The interface is the point: extractInvoiceLines(photo) always returns
// a Promise<Array<{ text: string, quantity: number }>>, in the order
// the lines appear on the invoice, regardless of what actually produces
// that array. Swapping this file's implementation for a real OCR/vision
// call later requires touching NOTHING else — app.js's delivery review
// flow only ever calls extractInvoiceLines() and has no idea whether the
// result came from a mock or a real API.
//
// The mock returns a fixed, deterministic example invoice (matching the
// exact scenario given in this phase's spec: Ost cheddar/Stora bröd/
// Bacon/Pommes) so the workflow itself — order preservation, matching,
// one-line-at-a-time review, discrepancy detection — can be built and
// tested for real right now, without waiting on an external service
// decision.
const MOCK_INVOICE_LINES = [
  { text: "Ost cheddar", quantity: 3 },
  { text: "Stora bröd", quantity: 4 },
  { text: "Bacon", quantity: 2 },
  { text: "Pommes", quantity: 5 },
];

async function extractInvoiceLines(photo) {
  // No artificial delay: a real request would genuinely take time, but
  // faking a wait here would violate the "never artificially slow the
  // interface" rule for something that isn't actually working yet.
  return MOCK_INVOICE_LINES.map((l) => ({ ...l }));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { extractInvoiceLines, MOCK_INVOICE_LINES };
}
