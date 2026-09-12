// Supabase Edge Function — the ONLY place the real OCR/AI provider's API
// key exists. It runs server-side (Deno, on Supabase's infrastructure),
// never in the browser. The client (ocrProvider.js) calls this function
// by name via supabaseClient.functions.invoke(); it never sees a
// provider secret, a provider URL, or provider-specific request shapes.
//
// Provider: Anthropic Claude (vision-capable model), chosen explicitly
// by the project owner over a dedicated invoice-parsing service (Azure
// Document Intelligence / Google Document AI) for pragmatic reasons —
// no new cloud account needed, good Swedish-text handling, and the
// existing "employee reviews and confirms every line" workflow already
// covers the main risk of a general vision model (occasional digit
// misreads) that a dedicated invoice parser would otherwise reduce.
// This tradeoff was disclosed, not assumed — see the phase report.
//
// Contract with the client (this is the swap boundary — a future
// different provider only needs to keep returning this same shape):
//   Request:  { path: string }  — a storage path in the private
//             "delivery-documents" bucket, e.g. "org-id/uuid.jpg"
//   Response: {
//     supplierName: string | null,
//     invoiceNumber: string | null,
//     invoiceDate: string | null,      // ISO yyyy-mm-dd if confidently read
//     lines: [{ text: string, quantity: number, unit: string | null,
//                unitPrice: number | null }],
//   }
// The response NEVER includes a product_id or any reference to this
// project's catalog — matching against the 17 real products happens
// entirely client-side in productMatcher.js. This function only ever
// reports what it read off the document; it has no concept of "the
// catalog" and therefore cannot invent or match a product.
//
// Security: downloads the invoice photo using the CALLER'S OWN JWT
// (forwarded automatically by supabaseClient.functions.invoke()), not a
// service-role key — so Supabase Storage's existing RLS policies (the
// caller can only read their own organization's folder in
// delivery-documents) apply exactly as they do everywhere else in this
// project. This function adds no new authorization logic of its own;
// it inherits the same boundary the rest of the app already relies on.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const EXTRACTION_PROMPT = `You are reading a real supplier invoice photographed by a restaurant employee. Extract exactly what is printed — never guess, never fill in a plausible-looking value you cannot actually read.

Return ONLY a JSON object (no prose, no markdown fences) with this exact shape:
{
  "supplierName": string or null,
  "invoiceNumber": string or null,
  "invoiceDate": string or null (ISO yyyy-mm-dd, only if you can read it confidently),
  "lines": [
    { "text": string, "quantity": number, "unit": string or null, "unitPrice": number or null }
  ]
}

Rules:
- "lines" must preserve the EXACT order the products appear on the invoice, top to bottom. Never reorder alphabetically or by any other criteria.
- "text" is the product description exactly as printed (do not translate it, do not correct spelling, do not rename it to match any product you might expect).
- "quantity" is the number printed for that line (e.g. how many units/boxes/kg — whatever the invoice itself shows).
- If you cannot confidently read a field, use null rather than guessing.
- Do not invent line items that aren't on the invoice. Do not omit line items that are on the invoice.
- The invoice may be in Swedish. Extract text as printed; do not translate product names.`;

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured as an Edge Function secret. See supabase/functions/extract-invoice/README.md.");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    const { path } = await req.json();
    if (!path || typeof path !== "string") throw new Error("Missing or invalid 'path'");

    // Uses the CALLER's JWT, not a service-role key — Storage RLS decides
    // whether this request can actually read this path, exactly as it
    // would for any other authenticated request in this app.
    const supabase = createClient(SUPABASE_URL, authHeader.replace("Bearer ", ""), {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("delivery-documents")
      .download(path);
    if (downloadError) throw new Error(`Could not read invoice photo: ${downloadError.message}`);

    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const mediaType = fileBlob.type || "image/jpeg";

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 2048,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`OCR provider error (${claudeRes.status}): ${errText.slice(0, 500)}`);
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData?.content?.[0]?.text ?? "";

    let parsed;
    try {
      // Defensive: strip an accidental ```json fence if the model adds one.
      const cleaned = rawText.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
      parsed = JSON.parse(cleaned);
    } catch (e) {
      throw new Error(`OCR provider returned non-JSON output: ${rawText.slice(0, 300)}`);
    }

    if (!Array.isArray(parsed.lines)) throw new Error("OCR provider response missing 'lines' array");

    return new Response(JSON.stringify({
      supplierName: parsed.supplierName ?? null,
      invoiceNumber: parsed.invoiceNumber ?? null,
      invoiceDate: parsed.invoiceDate ?? null,
      lines: parsed.lines.map((l: any) => ({
        text: String(l.text ?? ""),
        quantity: Number(l.quantity) || 0,
        unit: l.unit ?? null,
        unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
      })),
    }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 400,
      headers: { ...cors, "content-type": "application/json" },
    });
  }
});
