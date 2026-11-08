/* ==========================================================================
   netlify/functions/articles/articles.js
   Articles API for the AH Solution CMS.

   Public (no auth, published rows only):
     GET  /.netlify/functions/articles?action=list&limit=24&offset=0
     GET  /.netlify/functions/articles?action=list&slug=my-post

   Admin (Bearer = Supabase *user* JWT, verified server-side):
     POST { action:'list',    status?, limit?, offset?, category?, q? }
     POST { action:'create',  title, slug?, excerpt?, body, category?, tags?, cover_image_url?, seo_description?, status? }
     POST { action:'update',  id, ...same fields... }
     POST { action:'publish'  | 'unpublish', id }
     POST { action:'delete',  id, confirm:true }

   Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAILS
   ========================================================================== */
'use strict';

const {
  json, requireAdmin, serviceConfig, sbFetch,
  cleanSlug, SLUG_RE, str, articleRow,
  slugTaken, insertArticle, updateArticle, deleteArticle, listArticles, bumpViews
} = require('../_shared/supabase-rest.cjs');

const fail = (event, code, status, extra) => json(event, status, Object.assign({ ok: false, error: code }, extra || {}));

/* ------------------------------------------------------------------ *
 * Simple in-memory rate limiter (per serverless instance).
 * Reuses the pattern from netlify/functions/localize/localize.js.
 * ------------------------------------------------------------------ */
const RATE_LIMIT = Number(process.env.ARTICLES_RATE_LIMIT || 30);
const RATE_WINDOW_MS = Number(process.env.ARTICLES_RATE_WINDOW_MS || 600000);
const rateBuckets = new Map();

function clientIp(event) {
  const h = event.headers || {};
  return (h['x-forwarded-for'] || h['X-Forwarded-For'] || h['client-ip'] || '').split(',')[0].trim() || 'unknown';
}

function checkRate(event) {
  const ip = clientIp(event);
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  if (bucket.count > RATE_LIMIT) {
    return false;
  }
  return true;
}

function parseBody(event) {
  if (!event.body) return {};
  try { return JSON.parse(event.body); } catch (e) { return null; }
}

exports.handler = async (event) => {
  const method = event.httpMethod || 'GET';

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: json(event, 204, {}).headers, body: '' };
  }

  if (!serviceConfig()) return fail(event, 'missing_keys', 500);

  /* Rate limit: applies to all requests (public + admin) */
  if (!checkRate(event)) {
    return fail(event, 'rate_limited', 429, { retry_after_ms: RATE_WINDOW_MS });
  }

  try {
    /* ---------------- public read ---------------- */
    if (method === 'GET') {
      const qs = event.queryStringParameters || {};
      const action = qs.action || 'list';

      if (action !== 'list') return fail(event, 'unknown_action', 400);

      const slug = qs.slug ? str(qs.slug, 120) : '';
      const result = await listArticles({
        publishedOnly: true,
        slug: slug || undefined,
        category: qs.category ? str(qs.category, 50) : undefined,
        limit: qs.limit,
        offset: qs.offset
      });

      if (slug) {
        const row = result.rows[0];
        if (!row) return fail(event, 'not_found', 404);
        // strip the full body from list-shaped payloads is not needed here:
        // a slug request is a single article page and needs the body.
        bumpViews(row.id);
        return json(event, 200, { ok: true, article: row });
      }
      return json(event, 200, {
        ok: true,
        articles: result.rows.map(publicShape),
        limit: result.limit,
        offset: result.offset,
        total: result.rows.length
      });
    }

    if (method !== 'POST') return fail(event, 'method_not_allowed', 405);

    /* ---------------- admin write ---------------- */
    const auth = await requireAdmin(event);
    if (!auth.ok) return auth.response;

    const payload = parseBody(event);
    if (payload === null) return fail(event, 'bad_json', 400);
    const action = payload.action;
    if (!action) return fail(event, 'missing_action', 400);

    if (action === 'list') {
      const result = await listArticles({
        status: payload.status || undefined,
        category: payload.category || undefined,
        limit: payload.limit,
        offset: payload.offset
      });
      return json(event, 200, { ok: true, articles: result.rows, total: result.rows.length });
    }

    if (action === 'create' || action === 'update') {
      const row = articleRow(payload);
      if (!row.title) return fail(event, 'missing_title', 400);
      if (!row.slug) row.slug = cleanSlug(row.title);
      if (!SLUG_RE.test(row.slug)) return fail(event, 'invalid_slug', 400, { slug: row.slug });

      if (action === 'create') {
        if (await slugTaken(row.slug)) return fail(event, 'slug_taken', 400);
        /* SECURITY: always create as draft. Publication via dedicated action. */
        row.status = 'draft';
        const created = await insertArticle(row, auth.user.email);
        return json(event, 201, { ok: true, article: created });
      }

      const id = str(payload.id, 64);
      if (!id) return fail(event, 'missing_id', 400);
      // Omitting the slug on update keeps the stored slug; it is not
      // regenerated from the (possibly edited) title.
      if (!payload.slug) {
        const cur = await sbFetch('/rest/v1/articles?id=eq.' + encodeURIComponent(id) + '&select=slug');
        const rows = await cur.json().catch(() => []);
        if (cur.ok && rows && rows[0] && rows[0].slug) row.slug = rows[0].slug;
      }
      if (!SLUG_RE.test(row.slug)) return fail(event, 'invalid_slug', 400, { slug: row.slug });
      if (await slugTaken(row.slug, id)) return fail(event, 'slug_taken', 400);
      /* SECURITY: clients cannot set status/published_at/publish_at in create/update. These fields are never changed via
         update. Use dedicated publish/unpublish/schedule/archive/restore
         actions. Remove any client-provided values. */
      delete row.status;
      delete row.published_at;
      delete row.publish_at;
      const updated = await updateArticle(id, row);
      return json(event, 200, { ok: true, article: updated });
    }

    if (action === 'publish' || action === 'unpublish') {
      const id = str(payload.id, 64);
      if (!id) return fail(event, 'missing_id', 400);
      const status = action === 'publish' ? 'published' : 'draft';
      const patch = { status, updated_at: new Date().toISOString() };
      if (status === 'published') {
        patch.published_at = new Date().toISOString();
        patch.publish_at = null; /* clear any pending schedule */
      }
      const updated = await updateArticle(id, patch);
      return json(event, 200, { ok: true, article: updated });
    }

    if (action === 'schedule') {
      const id = str(payload.id, 64);
      if (!id) return fail(event, 'missing_id', 400);
      const publishAt = str(payload.publish_at, 40).trim();
      if (!publishAt) return fail(event, 'missing_publish_at', 400);
      /* Validate ISO timestamp */
      const d = new Date(publishAt);
      if (isNaN(d.getTime())) return fail(event, 'invalid_publish_at', 400);
      if (d.getTime() <= Date.now()) return fail(event, 'publish_at_must_be_future', 400);
      const patch = {
        status: 'draft',
        publish_at: publishAt,
        updated_at: new Date().toISOString()
      };
      const updated = await updateArticle(id, patch);
      return json(event, 200, { ok: true, article: updated });
    }

    if (action === 'archive') {
      const id = str(payload.id, 64);
      if (!id) return fail(event, 'missing_id', 400);
      const patch = { status: 'archived', updated_at: new Date().toISOString() };
      const updated = await updateArticle(id, patch);
      return json(event, 200, { ok: true, article: updated });
    }

    if (action === 'restore') {
      const id = str(payload.id, 64);
      if (!id) return fail(event, 'missing_id', 400);
      const patch = { status: 'draft', updated_at: new Date().toISOString() };
      const updated = await updateArticle(id, patch);
      return json(event, 200, { ok: true, article: updated });
    }

    if (action === 'cancel_schedule') {
      const id = str(payload.id, 64);
      if (!id) return fail(event, 'missing_id', 400);
      const patch = { publish_at: null, updated_at: new Date().toISOString() };
      const updated = await updateArticle(id, patch);
      return json(event, 200, { ok: true, article: updated });
    }

    if (action === 'delete') {
      const id = str(payload.id, 64);
      if (!id || payload.confirm !== true) return fail(event, 'missing_id_or_confirm', 400);
      await deleteArticle(id);
      return json(event, 200, { ok: true, deleted: id });
    }

    return fail(event, 'unknown_action', 400);
  } catch (e) {
    return fail(event, 'server_error', 500, { detail: String((e && e.message) || e).slice(0, 200) });
  }
};

/* public payloads never need author email, internal ids, or scheduling metadata */
function publicShape(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    body: row.body,
    cover_image_url: row.cover_image_url,
    category: row.category,
    tags: row.tags,
    reading_minutes: row.reading_minutes,
    published_at: row.published_at,
    view_count: row.view_count,
    new_until: row.new_until
  };
}
