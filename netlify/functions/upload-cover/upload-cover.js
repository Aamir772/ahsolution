/* ==========================================================================
   netlify/functions/upload-cover/upload-cover.js
   Article cover-image upload for the admin editor.

   POST /.netlify/functions/upload-cover
   Authorization: Bearer <Supabase user JWT>   (verified server-side)
   body: { filename, contentType, dataBase64 }

   The image is written to the public "covers" bucket and the resulting
   public URL is returned. The service-role key never reaches the browser.
   ========================================================================== */
'use strict';

const { json, env, requireAdmin, serviceConfig } = require('../_shared/supabase-rest.cjs');

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB
const ALLOWED_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif' };
const BUCKET = 'covers';

const fail = (event, code, status, extra) => json(event, status, Object.assign({ ok: false, error: code }, extra || {}));

exports.handler = async (event) => {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: json(event, 204, {}).headers, body: '' };
  }
  if (method !== 'POST') return fail(event, 'method_not_allowed', 405);

  const cfg = serviceConfig();
  if (!cfg) return fail(event, 'missing_keys', 500);

  const auth = await requireAdmin(event);
  if (!auth.ok) return auth.response;

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (e) { return fail(event, 'bad_json', 400); }

  const contentType = String(payload.contentType || '').toLowerCase();
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) return fail(event, 'unsupported_type', 415, { allowed: Object.keys(ALLOWED_TYPES) });

  let buffer;
  try { buffer = Buffer.from(String(payload.dataBase64 || ''), 'base64'); } catch (e) { return fail(event, 'bad_base64', 400); }
  if (!buffer.length) return fail(event, 'empty_file', 400);
  if (buffer.length > MAX_BYTES) return fail(event, 'too_large', 413, { maxBytes: MAX_BYTES });

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const safeBase = String(payload.filename || 'cover')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'cover';
  const path = stamp + '-' + safeBase + ext;

  const res = await fetch(cfg.url + '/storage/v1/object/' + BUCKET + '/' + path, {
    method: 'POST',
    headers: {
      apikey: cfg.key,
      Authorization: 'Bearer ' + cfg.key,
      'Content-Type': contentType,
      'x-upsert': 'true'
    },
    body: buffer
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return fail(event, 'upload_failed', 502, { detail: String((data && (data.message || data.error)) || res.status) });
  }

  const base = cfg.url.replace(/\/$/, '');
  return json(event, 200, {
    ok: true,
    bucket: BUCKET,
    path,
    url: base + '/storage/v1/object/public/' + BUCKET + '/' + path,
    publicUrl: base + '/storage/v1/object/public/' + BUCKET + '/' + path,
    note: env('SUPABASE_URL') ? 'stored in Supabase Storage' : ''
  });
};
