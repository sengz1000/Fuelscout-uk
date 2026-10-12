# FuelScout UK — beginner build (iPhone PWA)

FuelScout is a mobile-first progressive web app (PWA) for comparing UK fuel prices. Add it to an iPhone Home Screen from Safari; this avoids Apple Developer membership while validating demand. It is not yet a native App Store app.

## Current build status

- Mobile-first iPhone-friendly interface and PWA shell.
- Petrol/diesel/premium fuel selector and postcode search interface.
- Prices are sorted when an authorised provider returns them.
- No fake or sample prices are presented as live.
- A driver price-report form and Netlify serverless intake endpoint are included.
- Reports are stored as `pending` in Supabase when configured. A human moderation process is still needed before public display.
- **Live official fuel-price data is not connected.** The `/api/prices` endpoint intentionally returns a clear not-configured response until a data source is approved and integrated.

## Recommended low-budget stack

- **App/hosting:** Netlify free tier, subject to current plan limits.
- **Source code:** GitHub free repository.
- **Community report database:** Supabase free tier, subject to current plan limits.
- **Official prices:** UK Fuel Finder-compatible feed or a licensed data supplier that explicitly permits commercial reuse in an app.
- **Domain:** optional initially; purchase only after validation.

Do not put a provider secret or Supabase service-role key in browser JavaScript or in a public repository. Store secrets only in Netlify environment variables.

## Step 1 — deploy the app

1. Extract `fuelscout-uk-starter.zip` on your Mac.
2. Create a GitHub account and a new **private** repository called `fuelscout-uk`.
3. Upload the contents of this folder to the repository (the `index.html` must be at the repository root).
4. Create a Netlify account and import that GitHub repository.
5. Set the publish directory to `.`. The included `netlify.toml` specifies `netlify/functions`.
6. Deploy. Open the generated HTTPS URL on iPhone Safari → Share → Add to Home Screen.

## Step 2 — apply for real UK fuel-price data

The UK Fuel Finder scheme requires fuel retailers to share specified fuel-price information, but that does **not** automatically mean every app developer can call a single unrestricted public API. Before relying on a feed, verify current developer access and commercial terms with the official Fuel Finder programme or a data provider that participates in it.

Ask the data provider these exact questions:

1. Can a small independent app access station-level UK prices by postcode/radius?
2. Is commercial display in a consumer app permitted, including advertising and sponsored listings?
3. What are the price-update latency, geographic coverage, and fuel-grade identifiers?
4. May prices be cached? For how long? Must the source be attributed?
5. Are there API fees, rate limits, or requirements for registration/approval?
6. Does the feed include station coordinates, opening hours, and stable station IDs?
7. What is the documented API URL, authentication method, and response schema?

Do not scrape a consumer website or assume an undocumented endpoint is allowed. Do not publish as “live” until the source and update timestamp can be displayed and tested.

### Data adapter contract

The frontend calls `/api/prices?postcode=SW1A%201AA&fuel=E10`. The Netlify function should return this normalised shape once the provider integration is implemented:

```json
{
  "source": "Provider name",
  "updated_at": "2026-10-12T12:00:00Z",
  "stations": [
    {
      "station_id": "provider-station-id",
      "name": "Real station name",
      "address": "Real address",
      "price": 139.9,
      "distance_miles": 1.2,
      "fuel": "E10"
    }
  ]
}
```

This is a **schema example only**, not actual station data. The exact API authentication and mapping cannot responsibly be completed until the chosen provider supplies its current documentation and credentials. Keep provider calls on the server so credentials stay private.

## Step 3 — enable community price reports

1. Create a Supabase project on its free tier.
2. In Supabase, open **SQL Editor** and run `supabase/schema.sql`.
3. In Supabase project settings, copy the project URL and the **service role** key. Keep the service role key secret.
4. In Netlify site configuration → Environment variables, add:
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service role key
5. Redeploy the site.
6. Submit a test report. It should be saved with `status = pending` in the `fuel_reports` table.

Important: the starter accepts reports but does not yet expose them publicly or include a moderator dashboard. Before showing reports to users, add rate limiting/anti-spam protection and a moderation workflow. Only approved, recent reports should be visible, labelled as community-reported, with the observation time. Never merge them invisibly with official data.

## Step 4 — finish the live data integration

After you have the provider documentation and API credentials, edit `netlify/functions/prices.js`:

1. Read secrets from Netlify environment variables.
2. Validate postcode and fuel parameters.
3. Call only the provider's documented API endpoint.
4. Map provider fuel identifiers to E10/E5/B7 using its docs.
5. Normalise response fields to the schema above.
6. Include the real source name and timestamp; follow caching/attribution rules.
7. Return a clear error if the provider is unavailable; never fall back to invented prices.
8. Test a range of UK postcodes and compare a sample of results with the source itself.

Because the provider and its API contract are not yet selected, a fake “working” integration would be misleading. This package is deliberately honest about that blocker.

## Step 5 — launch checklist

Before promoting publicly:

- Live authorised data is connected and commercial reuse is confirmed in writing.
- Prices display the source and last-updated time.
- Community reports are moderated, time-stamped and rate-limited.
- Add a privacy notice, contact details, terms, cookie/analytics consent where required, and a process for deletion requests.
- Check UK GDPR and PECR requirements before collecting personal data, analytics or marketing consent.
- Add error monitoring, API usage limits and abuse protection.
- Make clear that forecourt prices and availability can change and drivers should check signage at the pump.

## Monetisation roadmap

**Phase 1 — validate (weeks 1–2, £0):** deploy the PWA, speak to 20–30 local drivers, recruit a small group of volunteer price reporters, and measure repeat use. Do not buy a domain or ads yet.

**Phase 2 — prove data quality (weeks 2–6):** secure commercial data rights, connect the real feed, show timestamps, add a simple fill-up savings calculator and favourites. Track search success and stale/missing prices.

**Phase 3 — first revenue (after stable data and repeat users):** test clearly labelled sponsored station placements and direct local forecourt partnerships. Apply to an advertising network only when eligible; early ad income may be negligible without meaningful traffic. Consider relevant affiliate offers only where a real programme exists and the terms permit it.

**Phase 4 — expand carefully:** add alerts only after implementing a reliable scheduled backend and a supported notification channel. Consider premium features only after user interviews show people will pay. Consider a native iOS App Store app only after the PWA has demonstrated demand; Apple Developer membership costs extra.

## Budget guardrails

Start at £0 with free tiers. Keep at least £50 of the £100 budget unspent until you have confirmed data access and terms. Do not buy an expensive API plan, paid ads, or Apple Developer membership before validating demand. Free-tier quotas and provider terms can change, so check current pricing before committing.
