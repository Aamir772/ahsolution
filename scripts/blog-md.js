/* ==========================================================================
   scripts/blog-md.js — AH Solution blog markdown pipeline (no dependencies)

   Parses the canonical draft format documented in blog/ARTICLE-FORMAT.md:
     # H1, draft banner blockquote, YouTube thumbnail line, intro, video meta,
     <!--TOC-->, H2/H3 sections, watch-video section, "## Image package"
     editorial tail, final "Editorial note".

   Exposes:
     loadManifest()             -> parsed blog/blog-manifest.json
     parseArticle(md)           -> { title, banner, bodyMd, tailMd, editorialNote }
     renderBody(bodyMd, opts)   -> { html, headings, words }
     buildToc(headings)         -> TOC html
     articleWordCount(md)       -> word count of the body (before Image package)
     slugify(text)              -> heading anchor ids
     isoDuration("MM:SS")       -> ISO-8601 duration (PT#M#S)
     videoJsonDiv(row)          -> hidden data-ah-video metadata element
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const BLOG_DIR = path.join(__dirname, '..', 'blog');
const ARTICLES_DIR = path.join(BLOG_DIR, 'articles');
const ASSETS_DIR = path.join(BLOG_DIR, 'assets');

function loadManifest() {
  return JSON.parse(fs.readFileSync(path.join(BLOG_DIR, 'blog-manifest.json'), 'utf8'));
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function articleWordCount(md) {
  const body = String(md).split(/\n## Image package\b/)[0];
  const cleaned = body.replace(/[#>*_`\[\]!]/g, ' ');
  const tokens = cleaned.match(/[A-Za-z0-9]+(?:['\u2019][A-Za-z]+)?|\u20B9[0-9,]+/g);
  return tokens ? tokens.length : 0;
}

function isoDuration(mmss) {
  const m = String(mmss || '').match(/^(\d+):(\d{2})$/);
  if (!m) return '';
  const min = parseInt(m[1], 10);
  const sec = parseInt(m[2], 10);
  if (min && sec) return 'PT' + min + 'M' + sec + 'S';
  if (min) return 'PT' + min + 'M';
  return 'PT' + sec + 'S';
}

function videoJsonDiv(row) {
  const data = {
    id: row.video_id,
    title: row.source_title,
    duration: isoDuration(row.video_duration),
    thumbnail: 'https://i.ytimg.com/vi/' + row.video_id + '/hqdefault.jpg',
    datePublished: row.video_publish_date
  };
  return '<div hidden data-ah-video=\'' + JSON.stringify(data).replace(/'/g, '&#39;') + '\'></div>';
}

function parseArticle(md) {
  const src = String(md || '').replace(/\r\n/g, '\n');

  let title = '';
  const h1 = src.match(/^# (.+)$/m);
  if (h1) title = h1[1].trim();

  let banner = '';
  const ban = src.match(/^> \*\*Draft for review[^\n]*\*\*$/m);
  if (ban) banner = ban[0];

  const tailIdx = src.search(/\n## Image package\b/);
  const bodyMd = tailIdx === -1 ? src : src.slice(0, tailIdx);
  const tailMd = tailIdx === -1 ? '' : src.slice(tailIdx + 1);

  let editorialNote = '';
  const ed = tailMd.match(/\*\*Editorial note:\*\*\s*([\s\S]+?)(?:\n---|\n*$)/);
  if (ed) editorialNote = ed[1].replace(/\s+/g, ' ').trim();

  // strip H1 line, banner blockquote and the raw thumbnail image line from the
  // rendered body — the page template renders those itself. Raw HTML comments
  // in a draft are authoring/review notes; the renderer escapes HTML, so they
  // would otherwise leak into the article as visible escaped text — drop them.
  let content = bodyMd
    .replace(/^# .+\n+/m, '')
    .replace(/^> \*\*Draft for review[^\n]*\*\*\n+/m, '')
    .replace(/^!\[[^\]]*\]\([^)]+\s*"[^"]*"\)\s*\n+/m, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  return { title, banner, bodyMd: content.trim(), tailMd, editorialNote };
}

/* --------------------------- inline markdown ---------------------------- */

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Article pages live at /article/<slug>/, so any root-relative-to-the-repo
   link written in the draft (blog.html, vlogs.html#shorts, /guides/…) has to
   be prefixed when rendered. `rootPrefix` defaults to two levels up. */
function siteHref(href, opts) {
  const prefix = (opts && opts.rootPrefix != null) ? opts.rootPrefix : '../../';
  if (!prefix) return href;
  if (/^(#|mailto:|tel:|https?:|\/\/)/.test(href)) return href;
  // A root-relative target ('/blog/assets/…') is fine at the domain root but
  // misses the host prefix on sub-path hosts (GitHub Pages project sites),
  // producing broken images and 404 navigations. Rewrite it to the same
  // page-relative form; an empty prefix keeps root-absolute rendering.
  if (href.startsWith('/')) return prefix + href.slice(1);
  return prefix + href.replace(/^\.\//, '');
}

function inline(text, opts) {
  let t = esc(text);
  // images (before links)
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, function (_m, alt, src, title) {
    return '<img src="' + siteHref(src, opts) + '" alt="' + alt + '"' + (title ? ' title="' + title + '"' : '') + ' loading="lazy" decoding="async">';
  });
  // links
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_m, label, href) {
    const external = /^https?:\/\//.test(href);
    return '<a href="' + siteHref(href, opts) + '"' + (external ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + label + '</a>';
  });
  // bold then italic
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  // inline code
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  return t;
}

/* ------------------------------ block parse ----------------------------- */

function renderBody(bodyMd, opts) {
  opts = opts || {};
  const lines = String(bodyMd || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  const headings = [];
  let i = 0;

  function flushParagraph(buf) {
    if (buf.length) {
      html.push('<p>' + inline(buf.join(' '), opts) + '</p>');
      buf.length = 0;
    }
  }

  /* "> **Tip:** …" style blockquotes become styled callout components */
  function calloutClass(buf) {
    const first = buf.join(' ').trim();
    const m = first.match(/^\*\*([^*]{2,60})\*\*/);
    const label = m ? m[1].toLowerCase() : '';
    if (/tip|pro tip|sujhaav|shortcut/.test(label)) return ' callout--tip';
    if (/warning|caution|dhyaan|khyal|legal|risk|scam|beware/.test(label)) return ' callout--warning';
    if (/note|editorial|clarification|disclosure|disclaimer|update|aaj ke liye/.test(label)) return ' callout--note';
    return '';
  }

  const para = [];

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // blank
    if (!trimmed) { flushParagraph(para); i++; continue; }

    // raw HTML block (iframe, div, etc.) — pass through until blank line
    if (/^<(iframe|div|figure|table|nav|aside|br|hr|script|style|video|audio)\b/i.test(trimmed) ||
        /^<\/(div|figure|table|nav|aside|video|audio)>/i.test(trimmed)) {
      flushParagraph(para);
      const buf = [];
      while (i < lines.length && lines[i].trim() !== '') { buf.push(lines[i]); i++; }
      html.push(buf.join('\n'));
      continue;
    }

    // TOC marker
    if (trimmed === '<!--TOC-->') {
      flushParagraph(para);
      html.push('__TOC__');
      i++;
      continue;
    }

    // headings
    const h = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      flushParagraph(para);
      const level = h[1].length;
      const text = h[2].trim();
      const id = slugify(text);
      headings.push({ level, text, id });
      html.push('<h' + level + ' id="' + id + '">' + inline(text, opts) + '</h' + level + '>');
      i++;
      continue;
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph(para);
      html.push('<hr>');
      i++;
      continue;
    }

    // blockquote
    if (trimmed.startsWith('>')) {
      flushParagraph(para);
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      html.push('<blockquote' + calloutClass(buf) + '><p>' + inline(buf.join(' '), opts) + '</p></blockquote>');
      continue;
    }

    // fenced code
    if (trimmed.startsWith('```')) {
      flushParagraph(para);
      const lang = trimmed.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++; }
      i++;
      html.push('<pre class="code' + (lang ? ' lang-' + lang : '') + '"><code>' + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }

    // pipe table
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && i + 1 < lines.length &&
        /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      flushParagraph(para);
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim());
        i++;
      }
      const cells = rows.map(function (r) {
        return r.slice(1, -1).split('|').map(function (c) { return inline(c.trim(), opts); });
      });
      const head = cells[0];
      const bodyRows = cells.slice(2);
      let t = '<div class="table-wrap"><table class="article-table"><thead><tr>' +
        head.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>';
      bodyRows.forEach(function (r) {
        t += '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      });
      t += '</tbody></table></div>';
      html.push(t);
      continue;
    }

    // unordered list (incl. task lists)
    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph(para);
      const items = [];
      let task = false;
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        let item = lines[i].trim().replace(/^[-*]\s+/, '');
        const tm = item.match(/^\[([ xX])\]\s+(.*)$/);
        if (tm) {
          task = true;
          item = '<span class="task' + (tm[1].trim() ? ' done' : '') + '" aria-hidden="true">' +
            (tm[1].trim() ? '\u2713' : '\u25FB') + '</span> ' + tm[2];
        }
        items.push('<li>' + inline(item, opts) + '</li>');
        i++;
      }
      html.push('<ul' + (task ? ' class="task-list"' : '') + '>' + items.join('') + '</ul>');
      continue;
    }

    // ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph(para);
      const items = [];
      const start = parseInt(trimmed.match(/^(\d+)\./)[1], 10);
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push('<li>' + inline(lines[i].trim().replace(/^\d+\.\s+/, ''), opts) + '</li>');
        i++;
      }
      html.push('<ol' + (start !== 1 ? ' start="' + start + '" style="counter-reset:ed-step ' + (start - 1) + '"' : '') + '>' + items.join('') + '</ol>');
      continue;
    }

    // paragraph (merge continuation lines)
    para.push(trimmed);
    i++;
  }
  flushParagraph(para);

  let out = html.join('\n');
  if (out.indexOf('__TOC__') !== -1) {
    out = out.replace(/__TOC__/g, buildToc(headings));
  }
  return { html: out, headings: headings, words: articleWordCount(bodyMd) };
}

const TOC_SKIP = /watch the original|image package/i;

function buildToc(headings) {
  const items = (headings || [])
    .filter(function (h) { return h.level === 2 && !TOC_SKIP.test(h.text); })
    .map(function (h) { return '<li><a href="#' + h.id + '">' + inline(h.text) + '</a></li>'; });
  if (!items.length) return '';
  return '<nav class="article-toc" aria-label="Table of contents">' +
    '<strong class="article-toc__title">Is guide mein kya cover hoga</strong>' +
    '<ol>' + items.join('') + '</ol></nav>';
}

/* Category -> blog filter chip key (must mirror assets/js/cms.js filterKey).
   Chip keys: android · windows · gadgets · photography · privacy · remote · about */
function filterKey(cat) {
  const c = String(cat || '').toLowerCase();
  if (/photograph|camera|night photo/.test(c)) return 'photography';
  if (/privacy|browser|streaming|safety|whatsapp|wamr/.test(c)) return 'privacy';
  if (/remote/.test(c)) return 'remote';
  if (/android|apps|connectivity/.test(c)) return 'android';
  if (/pc|windows|laptop|gaming/.test(c)) return 'windows';
  if (/gadget|watch|wear|smartphone|phone/.test(c)) return 'gadgets';
  if (/about|welcome/.test(c)) return 'about';
  return '';
}

function readingMinutes(words) {
  return Math.max(1, Math.round((words || 0) / 200));
}

module.exports = {
  BLOG_DIR, ARTICLES_DIR, ASSETS_DIR,
  loadManifest, parseArticle, renderBody, buildToc,
  articleWordCount, slugify, isoDuration, videoJsonDiv,
  filterKey, readingMinutes, inline
};
