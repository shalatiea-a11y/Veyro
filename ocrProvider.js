// Real invoice extraction. Calls the "extract-invoice" Supabase Edge
// Function (see supabase/functions/extract-invoice/index.ts) — the ONLY
// place the OCR/AI provider's API key exists, server-side, never in this
// file or anywhere else the browser can read. This file's job is purely
// the client-side half of the adapter boundary: call the function by
// name, return its structured result, throw a clear error otherwise.
// Swapping the underlying provider later means changing the Edge
// Function only — this file and everything that calls it stays the same.
//
// extractInvoiceLines(path) -> Promise<{
//   supplierName: string|null, invoiceNumber: string|null, invoiceDate: string|null,
//   lines: Array<{ text: string, quantity: number, unit: string|null, unitPrice: number|null }>
// }>
// `path` is the storage path of the already-uploaded invoice photo in
// the private "delivery-documents" bucket (e.g. "org-id/uuid.jpg") —
// the function downloads it itself using the caller's own session, so
// no image bytes need to be re-sent from the client beyond the original
// upload.
async function extractInvoiceLines(path) {
  if (!path) throw new Error("No invoice photo to extract from.");
  const { data, error } = await supabaseClient.functions.invoke("extract-invoice", {
    body: { path },
  });
  if (error) {
    // Supabase wraps a non-2xx Edge Function response in a generic
    // FunctionsHttpError; the function's own error message is in the
    // response body, not `error.message` — surface that instead when
    // available so the employee (or whoever reads the log) sees the
    // real reason (e.g. "ANTHROPIC_API_KEY is not configured") rather
    // than a generic "Edge Function returned a non-2xx status code".
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message || "Invoice extraction failed.");
  }
  if (!data || !Array.isArray(data.lines)) {
    throw new Error("Invoice extraction returned an unexpected response.");
  }
  return data;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { extractInvoiceLines };
}
