# Deploying `weekly-report`

Already deployed and scheduled (Mondays 06:30 UTC, via `pg_cron` — see
`schema.sql`'s "Weekly report scheduling" section). It currently returns
401 on every run because the two secrets below aren't set yet — nothing
sends until you do this.

## 1. Get a Resend API key

1. Go to <https://resend.com> and create a free account.
2. Create an API key under **API Keys**.
3. Without verifying a sending domain, Resend only delivers to the email
   address on your own Resend account — fine for testing to yourself
   (shalatiea@gmail.com), but branch managers won't receive it until you
   verify a domain (Resend → Domains — takes a few DNS records, ask if
   you want help with this once you have a domain).

## 2. Set the two secrets (Supabase Dashboard → Edge Functions → Secrets)

- `RESEND_API_KEY` — the key from step 1.
- `CRON_SECRET` — must be exactly `f2371e1a-27d1-4314-a50c-97146cb6af4e`
  (this is the value already baked into the scheduled `pg_cron` job that
  calls this function — changing it here without also updating the cron
  job in the database will just make every run fail with 401 again).

No redeploy needed — secrets apply on the next invocation.

## 3. Test it

Wait for Monday, or trigger it immediately from the SQL Editor:

```sql
select net.http_post(
  url := 'https://mmgdylbikusvjgczlrgy.supabase.co/functions/v1/weekly-report',
  headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'f2371e1a-27d1-4314-a50c-97146cb6af4e'),
  body := '{}'::jsonb
);
-- then check the result:
select status_code, content from net._http_response order by id desc limit 1;
```

## What this sends

One email per organization, to every profile with role `admin` or
`manager` in it: waste cost (SEK) for the last 7 days and its top
products, deliveries received, morning-inventory completion per
location, and any product currently below its `par_level`. Never
guesses a SEK figure for waste logged before a product had a known
`cost_price` — those are called out as "no known cost yet" instead.
