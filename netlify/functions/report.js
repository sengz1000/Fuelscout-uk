// Server-side intake for driver-submitted fuel reports.
// Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify environment variables.
// Reports enter as pending and must be moderated before being displayed as community data.
exports.handler = async function (event) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }) };
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { statusCode: 503, headers, body: JSON.stringify({ error: 'COMMUNITY_REPORTS_NOT_CONFIGURED', message: 'Community reporting is not configured yet.' }) };
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'INVALID_JSON' }) }; }
  const station_name = String(b.station_name || '').trim();
  const postcode = String(b.postcode || '').trim().toUpperCase();
  const fuel_type = String(b.fuel_type || 'E10').toUpperCase();
  const price = Number(b.price_ppl);
  const observed = new Date(b.observed_at || '');
  const notes = String(b.notes || '').trim().slice(0, 300) || null;
  if (station_name.length < 2 || station_name.length > 120 || postcode.length < 5 || postcode.length > 10 || !['E10','E5','B7','OTHER'].includes(fuel_type) || !Number.isFinite(price) || price < 50 || price > 400 || Number.isNaN(observed.getTime())) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'INVALID_REPORT', message: 'Check station, postcode, fuel type, price and observation time.' }) };
  }
  // Avoid accepting future-dated reports or very old reports. Keep source time explicit.
  const ageMs = Date.now() - observed.getTime();
  if (ageMs < -5 * 60 * 1000 || ageMs > 7 * 24 * 60 * 60 * 1000) return { statusCode: 400, headers, body: JSON.stringify({ error: 'OBSERVATION_TIME_OUT_OF_RANGE' }) };
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/fuel_reports`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ station_name, postcode, fuel_type: fuel_type === 'OTHER' ? 'other' : fuel_type, price_ppl: price, observed_at: observed.toISOString(), notes, status: 'pending' })
    });
    if (!response.ok) return { statusCode: 502, headers, body: JSON.stringify({ error: 'REPORT_SAVE_FAILED' }) };
    return { statusCode: 201, headers, body: JSON.stringify({ ok: true, message: 'Thanks — your report was submitted for review.' }) };
  } catch { return { statusCode: 502, headers, body: JSON.stringify({ error: 'REPORT_SERVICE_UNAVAILABLE' }) }; }
};
