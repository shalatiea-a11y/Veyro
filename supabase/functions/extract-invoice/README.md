# Deploying `extract-invoice`

This Edge Function is the only place the Anthropic API key exists. It is
never in the browser, never in this Git repository as a value (only as
`Deno.env.get("ANTHROPIC_API_KEY")`, which reads a secret configured
separately from the code).

## 1. Get an API key

1. Go to <https://console.anthropic.com>.
2. Create an account / sign in, and set up billing (Anthropic's API is
   pay-per-use — there is no free tier for production use; a few dozen
   invoices a day is a very small ongoing cost, but billing must be
   enabled before the key will work).
3. Create an API key under **API Keys**.

## 2. Configure it as a Supabase secret (never in code)

You need the Supabase CLI installed locally (`npm install -g supabase`
or see <https://supabase.com/docs/guides/cli>), logged in
(`supabase login`), and linked to this project
(`supabase link --project-ref <your-project-ref>` — the project ref is
in your Supabase dashboard URL).

```
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...your-key...
```

This stores it server-side in Supabase's infrastructure. It is not
written to any file in this repository.

## 3. Deploy the function

```
supabase functions deploy extract-invoice
```

## 4. Test it once, for real

After deploying, use the app itself: Delivery Receiving → attach a real
invoice photo → "Match products from this invoice". If it fails, check
the function's logs:

```
supabase functions logs extract-invoice
```

Common first-time issues:
- `ANTHROPIC_API_KEY is not configured` — the secret wasn't set, or you
  deployed before setting it (redeploy after setting secrets, or run
  `supabase secrets set` again then `supabase functions deploy extract-invoice`
  once more — secrets take effect on the next deploy/cold start).
- A 401/403 from Anthropic — the key is invalid or billing isn't enabled
  on the Anthropic account yet.
- "Could not read invoice photo" — the storage path passed to the
  function doesn't exist yet (the client should always upload the photo
  successfully before calling this function; if this happens, it points
  at a bug in that ordering, not the OCR provider).

## What this function does NOT do

It does not create, rename, or infer new products — it only reports
text and numbers it read off the document. Matching that text against
your real 17-product catalog happens entirely in the browser
(`productMatcher.js`), not here, and nothing in this function can add to
that catalog.
