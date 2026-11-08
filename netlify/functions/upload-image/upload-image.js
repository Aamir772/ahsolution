/* ==========================================================================
   netlify/functions/upload-image/upload-image.js
   Authenticated inline/body image upload for the admin editor.

   POST body: { filename, contentType, dataBase64, kind?: 'body'|'cover' }
   Writes to Supabase Storage bucket "images" (public). Service-role key never
   reaches the browser. Browser MIME is not trusted alone: magic bytes checked.
   ========================================================================== */
'use strict';

const crypto = require('crypto');
const { json, env, requireAdmin, serviceConfig } = require('../_shared/supabase-rest.cjs');

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = {
  'image/jpeg': { ext: '.jpg', sig: (b) => b[0]===0xff && b[1]===0xd8 && b[2]===0xff },
  'image/png':  { ext: '.png', sig: (b) => b[0]===0x89 && b[1]===0x50 && b[2]===0x4e && b[3]===0x47 },
  'image/webp': { ext: '.webp', sig: (b) => b[0]===0x52 && b[1]===0x49 && b[2]===0x46 && b[3]===0x46 && b[8]===0x57 && b[9]===0x45 && b[10]===0x42 && b[11]===0x50 },
  'image/avif': { ext: '.avif', sig: (b) => b[4]===0x66 && b[5]===0x74 && b[6]===0x79 && b[7]===0x70 && (String.fromCharCode(b[8],b[9],b[10],b[11]).includes('avif') || String.fromCharCode(b[8],b[9],b[10],b[11]).includes('avis')) }
};
const BUCKET = 'images';
const fail = (event, code, status, extra) => json(event, status, Object.assign({ ok: false, error: code }, extra || {}));

exports.handler = async (event) => {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return { statusCode: 204, headers: json(event, 204, {}).headers, body: '' };
  if (method !== 'POST') return fail(event, 'method_not_allowed', 405);
  const cfg = serviceConfig();
  if (!cfg) return fail(event, 'missing_keys', 500);
  const auth = await requireAdmin(event);
  if (!auth.ok) return auth.response;

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (e) { return fail(event, 'bad_json', 400); }
  const contentType = String(payload.contentType || '').toLowerCase();
  const spec = ALLOWED[contentType];
  if (!spec) return fail(event, 'unsupported_type', 415, { allowed: Object.keys(ALLOWED) });

  let buffer;
  try { buffer = Buffer.from(String(payload.dataBase64 || ''), 'base64'); } catch (e) { return fail(event, 'bad_base64', 400); }
  if (!buffer.length) return fail(event, 'empty_file', 400);
  if (buffer.length > MAX_BYTES) return fail(event, 'too_large', 413, { maxBytes: MAX_BYTES });
  if (!spec.sig(buffer)) return fail(event, 'signature_mismatch', 415, { detail: 'File content does not match declared image type.' });
  // Reject SVG masquerading (basic): if starts with '<' or contains <svg
  const head = buffer.slice(0, 256).toString('utf8').toLowerCase();
  if (head.includes('<svg') || head.trim().startsWith('<?xml') || head.trim().startsWith('<!doctype')) {
    return fail(event, 'unsupported_type', 415, { detail: 'SVG/XML uploads are not allowed.' });
  }

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const safeBase = String(payload.filename || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'image';
  const rand = crypto.randomBytes(4).toString('hex');
  const folder = String(payload.kind || 'body').replace(/[^a-z]/g, '') === 'cover' ? 'covers' : 'body';
  const path = folder + '/' + stamp + '-' + safeBase + '-' + rand + spec.ext;

  const res = await fetch(cfg.url + '/storage/v1/object/' + BUCKET + '/' + path, {
    method: 'POST',
    headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': contentType, 'x-upsert': 'false' },
    body: buffer
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return fail(event, 'upload_failed', 502, { detail: String((data && (data.message || data.error)) || res.status) });
  const base = cfg.url.replace(/\/$/, '');
  const url = base + '/storage/v1/object/public/' + BUCKET + '/' + path;
  return json(event, 200, { ok: true, bucket: BUCKET, path, url, publicUrl: url, contentType, bytes: buffer.length });
};
