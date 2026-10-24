require('dotenv').config();
const { randomBytes } = require('crypto');

async function main() {
  const partnerUrl = process.env.PARTNER_URL;
  const partnerKey = process.env.PARTNER_API_KEY;
  const myApi = (process.argv[2] || process.env.MEDITRAC_API_URL || '').replace(/\/+$/, '');
  if (!partnerUrl || !partnerKey) throw new Error('Set PARTNER_URL and PARTNER_API_KEY in server/.env');
  if (!myApi) throw new Error('Set MEDITRAC_API_URL in server/.env (your Render address, no /api at the end)');

  console.log('Fetching artisans from the partner (their server may take a minute to wake up)...');
  const r = await fetch(`${partnerUrl}/artisans`, { headers: { 'X-API-Key': partnerKey } });
  if (!r.ok) throw new Error(`Partner returned HTTP ${r.status}`);
  const body = await r.json();
  const artisans = Array.isArray(body) ? body : body.artisans || body.data || [];
  console.log(`Fetched ${artisans.length} artisans`);

  let added = 0, existing = 0, skipped = 0;
  for (const a of artisans) {
    const name = String(a.name || '').trim().slice(0, 150);
    const email = `artisan-${a.id}@find-my-artisan.invalid`;
    if (!name) { skipped++; continue; }

    let res;
    try {
      res = await fetch(`${myApi}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountType: 'user', name, email, password: randomBytes(16).toString('hex') }),
      });
    } catch (err) {
      console.error('Could not reach your API:', err.cause?.code || err.message);
      process.exitCode = 1;
      return;
    }

    if (res.status === 201) added++;
    else if (res.status === 409) existing++;
    else if (res.status === 429) {
      console.error(`Rate limit hit (HTTP 429) after ${added} added. Wait ${res.headers.get('retry-after') || 'a while'} seconds, or raise REGISTER_LIMIT_PER_HOUR on Render, then run again.`);
      break;
    } else {
      skipped++;
      let msg = '';
      try { msg = (await res.json()).error || ''; } catch { /* not JSON */ }
      console.error(`Skipped "${name}": HTTP ${res.status} ${msg}`);
    }
  }
  console.log(`Done: ${added} added, ${existing} already existed, ${skipped} skipped.`);
}

main().catch((err) => { console.error('Sync failed:', err.cause?.code || err.message); process.exitCode = 1; });