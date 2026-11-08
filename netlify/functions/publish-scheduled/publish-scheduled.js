/* ==========================================================================
   netlify/functions/publish-scheduled/publish-scheduled.js
   Scheduled publisher (Netlify Scheduled Function). Finds due draft articles
   (publish_at <= now) and transitions them to published idempotently.
   Triggers a site build after publishing due articles.
   Configured via netlify.toml [functions."publish-scheduled"] schedule.
   ========================================================================== */
'use strict';

const { serviceConfig, sbFetch } = require('../_shared/supabase-rest.cjs');

exports.config = { schedule: '*/15 * * * *' }; // Netlify minimum cadence may vary; document actual

async function triggerBuild(reason) {
  const hook = process.env.NETLIFY_BUILD_HOOK_URL;
  if (!hook) return { ok: false, error: 'no_build_hook' };
  try {
    const res = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
    return { ok: res.ok, status: res.status };
  } catch (e) { return { ok: false, error: e.message }; }
}

exports.handler = async () => {
  const cfg = serviceConfig();
  if (!cfg) return { statusCode: 500, body: JSON.stringify({ ok:false, error:'missing_keys' }) };
  const now = new Date().toISOString();
  // Find due scheduled drafts
  const listRes = await sbFetch('/rest/v1/articles?select=id,slug,publish_at&status=eq.draft&publish_at=not.is.null&publish_at=lte.' + encodeURIComponent(now) + '&limit=50');
  const rows = await listRes.json().catch(() => []);
  if (!listRes.ok || !Array.isArray(rows) || rows.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ ok:true, published:0, checked_at: now }) };
  }
  let published = 0;
  const errors = [];
  for (const row of rows) {
    // Idempotent: only publish if still draft and publish_at still due
    const patch = { status: 'published', published_at: now, publish_at: null, updated_at: now };
    const upd = await sbFetch('/rest/v1/articles?id=eq.' + encodeURIComponent(row.id) + '&status=eq.draft&publish_at=lte.' + encodeURIComponent(now), {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch)
    });
    const data = await upd.json().catch(() => []);
    if (upd.ok && Array.isArray(data) && data.length) published++;
    else if (!upd.ok) errors.push({ id: row.id, status: upd.status });
  }
  let build = null;
  if (published > 0) build = await triggerBuild('scheduled_publish');
  return { statusCode: 200, body: JSON.stringify({ ok:true, published, attempted: rows.length, errors, build, checked_at: now }) };
};
