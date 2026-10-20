/* ==========================================================================
   AH SOLUTION — ai.js
   SOLUTION AI: activation core, holographic panel, hybrid retrieval
   (site knowledge first, hosted AI as a fallback), voice input/output.
   Homepage only. Vanilla JS, zero dependencies. Degrades gracefully.
   ========================================================================== */
(() => {
  'use strict';

  const panel = document.querySelector('[data-ai-panel]');
  const openBtn = document.querySelector('[data-ai-open]');
  const heroCore = document.querySelector('[data-hero-core]');
  if (!panel || !openBtn) return;

  const html = document.documentElement;
  const INDEX_URL = 'assets/data/ai-index.json';

  /* ------------------------------------------------------------------ *
   * Backend base.
   *  - an explicit window.__AH_ASSISTANT_BASE__ or <meta name="ah-assistant-base">
   *    always wins (used by QA and staging);
   *  - on localhost we default to the local assistant server;
   *  - in production we talk to the same origin.
   * ------------------------------------------------------------------ */
  function resolveBase() {
    try {
      if (typeof window.__AH_ASSISTANT_BASE__ === 'string') return window.__AH_ASSISTANT_BASE__.replace(/\/+$/, '');
      const meta = document.querySelector('meta[name="ah-assistant-base"]');
      if (meta && typeof meta.content === 'string' && meta.content) return meta.content.replace(/\/+$/, '');
      const h = location.hostname;
      if (h === 'localhost' || h === '127.0.0.1') return 'http://127.0.0.1:8787';
    } catch (e) { /* ignore */ }
    return '';
  }
  const BASE = resolveBase();
  const CHAT_URL = BASE + '/api/chat';
  const HEALTH_URL = BASE + '/health';
  const VOICE_URL = BASE + '/api/voice';
  const AGENT_URL = BASE + '/api/agent';
  const SESSION_KEY = 'ah_ai_session';
  const REQUEST_TIMEOUT_MS = 30000;

  const messagesEl = panel.querySelector('[data-ai-messages]');
  const input = panel.querySelector('[data-ai-input]');
  const form = panel.querySelector('[data-ai-form]');
  const sendBtn = panel.querySelector('[data-ai-send]');
  const quickEl = panel.querySelector('[data-ai-quick]');
  const statusEl = panel.querySelector('[data-ai-status]');
  const clearBtn = panel.querySelector('[data-ai-clear]');
  const closeBtn = panel.querySelector('[data-ai-close]');
  const micBtn = panel.querySelector('[data-ai-mic]');
  const speakBtn = panel.querySelector('[data-ai-speak]');
  const langSel = panel.querySelector('[data-ai-lang]');
  const noteEl = panel.querySelector('[data-ai-note]');
  const voiceBtn = panel.querySelector('[data-ai-voice]');
  const voiceMuteBtn = panel.querySelector('[data-ai-voice-mute]');
  const voiceStateEl = panel.querySelector('[data-ai-voice-state]');
  const voiceAudio = panel.querySelector('[data-ai-voice-audio]');

  const reduce = (() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------------------------------------------------------- *
   * i18n
   * ---------------------------------------------------------------- */
  const I18N = {
    en: {
      ready: 'Ready',
      aiMode: 'AI + site content',
      knowledgeMode: 'Site knowledge mode',
      welcome: "Hello, I'm SOLUTION AI. Ask me about any AH Solution tutorial, guide, or video — or a general tech question, and I'll keep it simple.",
      placeholder: 'Ask about a tutorial, app, or PC tip…',
      quick: [
        'Find a Windows tutorial',
        'Set a live wallpaper on PC',
        'Is this app safe to install?',
        'What to check before buying a smartwatch',
        'Show me the latest videos'
      ],
      thinking: 'Searching AH Solution…',
      foundIntro: "Here's what I found on AH Solution:",
      noMatch: "I couldn't find that in AH Solution's content yet. Try 'android', 'pc', 'wallpaper', 'smartwatch', or ask me to explain a tech topic.",
      unavailable: "The AI assist isn't available right now, so here's what AH Solution has:",
      offline: "You're offline, but AH Solution's own content still works:",
      errorGeneric: 'Something went wrong reaching SOLUTION AI. Please try again in a moment.',
      copy: 'Copy',
      copied: 'Copied ✓',
      retry: 'Retry',
      stop: 'Stop',
      stopping: 'Stopping…',
      noteKnowledge: 'Answers come from AH Solution content. Add an AI key for richer replies.',
      noteAi: 'Answers use AH Solution content, with a light AI assist.',
      conn_connecting: 'Connecting…',
      conn_cloud: 'Cloud model',
      conn_local: 'Local model',
      conn_knowledge: 'Site knowledge mode',
      conn_offline: 'Offline',
      conn_error: 'AI unavailable',
      note_connecting: 'Contacting the AI service…',
      note_cloud: 'Connected to the cloud AI model.',
      note_local: 'Connected to your local AI model.',
      note_setup: 'No AI model is connected yet, so answers use AH Solution content only. To enable live AI, start the assistant server with a provider (AH_PROVIDER plus an API key) or a local model, then reload.',
      note_offline: 'The assistant service is unreachable. AH Solution content still works.',
      note_error: 'The AI model did not respond. Showing AH Solution content instead.',
      you: 'You',
      listening: 'Listening…',
      micDenied: 'Microphone permission was blocked.',
      micUnsupported: 'Voice input is not supported in this browser.',
      more: 'Explore more',
      guide: 'Guide',
      page: 'Page',
      video: 'YouTube video',
      short: 'YouTube Short',
      voiceLabel: 'Voice',
      voiceStart: 'Start voice conversation',
      voiceStop: 'End voice conversation',
      voiceMute: 'Mute microphone',
      voiceUnmute: 'Unmute microphone',
      voicePlay: 'Your browser blocked audio — tap the panel to allow sound.',
      voiceUnavailable: "Live voice isn't available on this server yet — you can keep typing.",
      voiceUnsupported: "Voice isn't supported in this browser — you can keep typing.",
      voiceMicDenied: 'Microphone permission was blocked — you can keep typing.',
      voiceFailed: "Couldn't start the voice connection — you can keep typing.",
      voiceError: 'The voice session failed — you can keep typing.',
      voiceEnded: 'Voice conversation ended.',
      voiceTimedOut: 'Voice session reached its time limit.',
      st_connecting: 'Connecting…',
      st_listening: 'Listening…',
      st_processing: 'Thinking…',
      st_speaking: 'Speaking…',
      st_error: 'Voice error'
    },
    hi: {
      ready: 'तैयार',
      aiMode: 'AI + साइट कंटेंट',
      knowledgeMode: 'साइट नॉलेज मोड',
      welcome: 'नमस्ते, मैं SOLUTION AI हूँ। AH Solution के किसी भी ट्यूटोरियल, गाइड या वीडियो के बारे में पूछें — या कोई भी टेक सवाल, मैं आसान भाषा में समझाऊँगा।',
      placeholder: 'किसी ट्यूटोरियल, ऐप या PC टिप के बारे में पूछें…',
      quick: [
        'Windows ट्यूटोरियल खोजें',
        'PC पर live wallpaper सेट करें',
        'कोई ऐप इंस्टॉल करने से पहले क्या जाँचें?',
        'स्मार्टवॉच खरीदने से पहले क्या देखें',
        'नवीनतम वीडियो दिखाएँ'
      ],
      thinking: 'AH Solution में खोज रहा हूँ…',
      foundIntro: 'AH Solution पर मुझे यह मिला:',
      noMatch: "यह अभी AH Solution के कंटेंट में नहीं मिला। 'android', 'pc', 'wallpaper', 'smartwatch' आज़माएँ, या कोई टेक विषय समझने को कहें।",
      unavailable: 'AI सहायता अभी उपलब्ध नहीं है, फिर भी AH Solution के पास यह है:',
      offline: 'आप ऑफ़लाइन हैं, लेकिन AH Solution का कंटेंट अभी भी काम करता है:',
      errorGeneric: 'SOLUTION AI से संपर्क नहीं हो सका। थोड़ी देर में फिर कोशिश करें।',
      copy: 'कॉपी',
      copied: 'कॉपी हो गया ✓',
      retry: 'फिर कोशिश करें',
      stop: 'रोकें',
      stopping: 'रोक रहे हैं…',
      noteKnowledge: 'जवाब AH Solution कंटेंट से हैं। बेहतर जवाब के लिए AI की ज़रूरत नहीं — जानकारी साइट से आती है।',
      noteAi: 'जवाब AH Solution कंटेंट और हल्की AI सहायता से।',
      conn_connecting: 'कनेक्ट हो रहा है…',
      conn_cloud: 'क्लाउड मॉडल',
      conn_local: 'लोकल मॉडल',
      conn_knowledge: 'साइट नॉलेज मोड',
      conn_offline: 'ऑफ़लाइन',
      conn_error: 'AI अनुपलब्ध',
      note_connecting: 'AI सेवा से संपर्क हो रहा है…',
      note_cloud: 'क्लाउड AI मॉडल से जुड़ गया।',
      note_local: 'आपके लोकल AI मॉडल से जुड़ गया।',
      note_setup: 'अभी कोई AI मॉडल कनेक्ट नहीं है, इसलिए जवाब सिर्फ़ AH Solution कंटेंट से आते हैं। लाइव AI के लिए असिस्टेंट सर्वर को किसी प्रोवाइडर (AH_PROVIDER + API key) या लोकल मॉडल के साथ चालू करें, फिर रीलोड करें।',
      note_offline: 'असिस्टेंट सेवा उपलब्ध नहीं है। AH Solution कंटेंट अभी भी काम करता है।',
      note_error: 'AI मॉडल ने जवाब नहीं दिया। इसके बजाय AH Solution कंटेंट दिखाया जा रहा है।',
      you: 'आप',
      listening: 'सुन रहा हूँ…',
      micDenied: 'माइक्रोफ़ोन की अनुमति रोक दी गई।',
      micUnsupported: 'इस ब्राउज़र में वॉइस इनपुट उपलब्ध नहीं है।',
      more: 'और देखें',
      guide: 'गाइड',
      page: 'पेज',
      video: 'YouTube वीडियो',
      short: 'YouTube Short',
      voiceLabel: 'वॉइस',
      voiceStart: 'वॉइस बातचीत शुरू करें',
      voiceStop: 'वॉइस बातचीत समाप्त करें',
      voiceMute: 'माइक्रोफ़ोन म्यूट करें',
      voiceUnmute: 'माइक्रोफ़ोन अनम्यूट करें',
      voicePlay: 'ब्राउज़र ने ऑडियो रोका — आवाज़ के लिए पैनल पर टैप करें।',
      voiceUnavailable: 'इस सर्वर पर लाइव वॉइस अभी उपलब्ध नहीं है — आप टाइप कर सकते हैं।',
      voiceUnsupported: 'इस ब्राउज़र में वॉइस समर्थित नहीं है — आप टाइप कर सकते हैं।',
      voiceMicDenied: 'माइक्रोफ़ोन की अनुमति रोक दी गई — आप टाइप कर सकते हैं।',
      voiceFailed: 'वॉइस कनेक्शन शुरू नहीं हो सका — आप टाइप कर सकते हैं।',
      voiceError: 'वॉइस सत्र विफल रहा — आप टाइप कर सकते हैं।',
      voiceEnded: 'वॉइस बातचीत समाप्त हो गई।',
      voiceTimedOut: 'वॉइस सत्र की समय सीमा पूरी हो गई।',
      st_connecting: 'कनेक्ट हो रहा है…',
      st_listening: 'सुन रहा हूँ…',
      st_processing: 'सोच रहा हूँ…',
      st_speaking: 'बोल रहा हूँ…',
      st_error: 'वॉइस त्रुटि'
    }
  };
  let lang = 'en';
  const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;

  /* ---------------------------------------------------------------- *
   * State
   * ---------------------------------------------------------------- */
  let entries = null;
  let indexPromise = null;
  let history = [];
  let busy = false;
  let aiConfigured = null;          // null=unknown, true/false
  let speakOut = false;
  let listening = false;
  let openedAt = 0;
  let recognition = null;
  let quickLocal = false;           // force a local answer for the next send

  let connectionState = null;       // connecting | cloud | local | knowledge | offline | error
  let connectionDetail = null;      // { id, kind, model }
  let statusChecked = false;
  let activeController = null;      // AbortController for the in-flight request
  let sessionId = null;
  try { sessionId = sessionStorage.getItem(SESSION_KEY) || null; } catch (e) { sessionId = null; }

  const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'am',
    'how', 'do', 'does', 'i', 'you', 'my', 'me', 'we', 'what', 'where', 'which', 'with', 'can', 'could',
    'please', 'show', 'find', 'give', 'tell', 'about', 'want', 'need', 'it', 'this', 'that', 'from', 'your',
    'ka', 'ke', 'ki', 'hai', 'hain', 'kya', 'mein', 'ke', 'ko', 'se', 'par', 'aur']);

  const has = (s) => s && s !== 'undefined';

  /* ---------------------------------------------------------------- *
   * Retrieval (client-side, free)
   * ---------------------------------------------------------------- */
  function tokenize(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9\u0900-\u097F\s]+/g, ' ')
      .split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
  }
  function scoreEntry(e, qt) {
    const title = (e.title || '').toLowerCase();
    const heads = ((e.headings || []).join(' ') || '').toLowerCase();
    const kw = (e.keywords || '').toLowerCase();
    const text = (e.text || '').toLowerCase();
    let s = 0;
    for (const tk of qt) {
      if (title.includes(tk)) s += 3;
      if (heads.includes(tk)) s += 2;
      if (kw.includes(tk)) s += 2;
      if (text.includes(tk)) s += 1;
    }
    const phrase = qt.join(' ');
    if (phrase.length > 3 && (title.includes(phrase) || text.includes(phrase))) s += 3;
    return s;
  }
  function retrieve(q, k = 3) {
    if (!entries || !entries.length) return [];
    const qt = tokenize(q);
    if (!qt.length) return [];
    return entries.map((e) => ({ entry: e, score: scoreEntry(e, qt) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
  function toSource(e) {
    const type = e.type;
    return {
      title: e.title,
      url: e.url,
      type,
      isShort: !!e.isShort,
      thumbnail: e.thumbnail || '',
      label: type === 'video' ? t(e.isShort ? 'short' : 'video') : type === 'article' ? t('guide') : t('page')
    };
  }
  function defaultSources() {
    if (!entries) return [];
    const want = ['vlogs.html', 'blog.html', 'index.html#categories', 'tutorials.html'];
    const out = [];
    for (const u of want) {
      const e = entries.find((x) => x.url === u);
      if (e) out.push(toSource(e));
    }
    return out;
  }

  // Server sources carry { title, url, snippet, score }; map them onto the local
  // index entry so we keep our type/thumbnail/label rendering.
  function enrichSources(serverSources) {
    if (!Array.isArray(serverSources)) return [];
    return serverSources.map((s) => {
      if (!s || !s.url) return null;
      const e = entries && entries.find((x) => x.url === s.url);
      if (e) { const src = toSource(e); if (s.title) src.title = s.title; return src; }
      return { title: s.title || s.url, url: s.url, type: 'page', isShort: false, thumbnail: '', label: t('page') };
    }).filter(Boolean);
  }

  /* ---------------------------------------------------------------- *
   * Index loading
   * ---------------------------------------------------------------- */
  function ensureIndex() {
    if (indexPromise) return indexPromise;
    indexPromise = fetch(INDEX_URL, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('index'))))
      .then((d) => { entries = Array.isArray(d && d.entries) ? d.entries : []; return entries; })
      .catch(() => { entries = []; return entries; });
    return indexPromise;
  }

  /* ---------------------------------------------------------------- *
   * Rendering
   * ---------------------------------------------------------------- */
  function renderText(s) {
    return String(s).split(/\n+/).map((l) => l.trim()).filter(Boolean).map((line) => {
      let h = esc(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
      return '<p>' + h + '</p>';
    }).join('');
  }

  function sourceChips(sources) {
    const chips = (sources || []).filter((s) => !s.isShort && s.type !== 'video').map((s) =>
      '<a class="ai-source" href="' + esc(s.url) + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>' +
      esc(s.title) + '</a>').join('');
    return chips ? '<div class="ai-sources">' + chips + '</div>' : '';
  }

  function videoCards(sources) {
    const vids = (sources || []).filter((s) => s.type === 'video');
    if (!vids.length) return '';
    return '<div class="ai-cards">' + vids.map((v) =>
      '<a class="ai-card' + (v.isShort ? ' ai-card--short' : '') + '" href="' + esc(v.url) + '" target="_blank" rel="noopener noreferrer">' +
      '<span class="ai-card__thumb">' + (v.thumbnail ? '<img src="' + esc(v.thumbnail) + '" alt="" loading="lazy" decoding="async">' : '') + '</span>' +
      '<span class="ai-card__meta"><strong>' + esc(v.title) + '</strong><span>' + esc(v.label || '') + '</span></span>' +
      '</a>').join('') + '</div>';
  }

  function scope() {
    if (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight > 60) return;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addUser(text) {
    const el = document.createElement('div');
    el.className = 'ai-msg ai-msg--user';
    el.innerHTML = '<div class="ai-msg__bubble">' + renderText(text) + '</div>';
    messagesEl.appendChild(el);
    scope();
  }

  function addAi(text, sources, mode) {
    const el = document.createElement('div');
    el.className = 'ai-msg ai-msg--ai' + (mode === 'error' ? ' ai-msg--error' : '');
    const raw = String(text || '');
    el.innerHTML =
      '<span class="ai-msg__avatar" aria-hidden="true"></span>' +
      '<div class="ai-msg__bubble">' + renderText(raw) + sourceChips(sources) + videoCards(sources) +
      '<div class="ai-msg__actions"><button type="button" class="ai-text-btn" data-ai-copy>' + t('copy') + '</button></div>' +
      '</div>';
    messagesEl.appendChild(el);
    el.querySelector('[data-ai-copy]').addEventListener('click', function () {
      const btn = this;
      navigator.clipboard.writeText(raw).then(() => {
        btn.textContent = t('copied');
        setTimeout(() => { btn.textContent = t('copy'); }, 1600);
      }).catch(() => {});
    });
    scope();
    return el;
  }

  function addTyping(onStop) {
    const el = document.createElement('div');
    el.className = 'ai-msg ai-msg--ai';
    el.innerHTML = '<span class="ai-msg__avatar" aria-hidden="true"></span>' +
      '<div class="ai-msg__bubble"><span class="ai-typing" role="status" aria-label="' + esc(t('thinking')) + '"><i></i><i></i><i></i></span>' +
      (onStop ? '<div class="ai-msg__actions"><button type="button" class="ai-text-btn" data-ai-stop>' + t('stop') + '</button></div>' : '') +
      '</div>';
    messagesEl.appendChild(el);
    if (onStop) {
      const b = el.querySelector('[data-ai-stop]');
      if (b) b.addEventListener('click', () => { b.disabled = true; b.textContent = t('stopping'); onStop(); });
    }
    scope();
    return el;
  }

  function addRecoverableError(text) {
    const el = document.createElement('div');
    el.className = 'ai-msg ai-msg--ai ai-msg--error';
    el.innerHTML = '<span class="ai-msg__avatar" aria-hidden="true"></span>' +
      '<div class="ai-msg__bubble">' + renderText(t('errorGeneric')) +
      '<div class="ai-msg__actions"><button type="button" class="ai-text-btn" data-ai-retry>' + t('retry') + '</button></div></div>';
    messagesEl.appendChild(el);
    const b = el.querySelector('[data-ai-retry]');
    if (b) b.addEventListener('click', () => { el.remove(); send(text); });
    scope();
    return el;
  }

  function renderWelcome() {
    if (messagesEl.childElementCount) return;
    addAi(t('welcome'), [], 'intro');
  }

  function renderQuick() {
    const items = t('quick');
    quickEl.innerHTML = items.map((q) => '<button type="button" data-ai-quick-btn>' + esc(q) + '</button>').join('');
    quickEl.hidden = false;
  }

  /* ---------------------------------------------------------------- *
   * Local (knowledge) answers
   * ---------------------------------------------------------------- */
  function localAnswer(q, results) {
    const list = results && results.length ? results.slice(0, 3) : [];
    if (!list.length) {
      return { reply: t('noMatch'), sources: defaultSources(), mode: 'knowledge' };
    }
    const lines = list.map((r) => '\u2022 ' + r.entry.title + (r.entry.description ? ' \u2014 ' + r.entry.description : ''));
    return { reply: t('foundIntro') + '\n' + lines.join('\n'), sources: list.map((r) => toSource(r.entry)), mode: 'knowledge' };
  }

  function isLookupIntent(q) {
    return /\b(find|show|where|search|watch|video|tutorial|guide|article|link|page|categor)\w*/i.test(q) ||
      /\b(android|windows|pc|laptop|smartwatch|wallpaper|permission|app)\b/i.test(q);
  }

  /* ---------------------------------------------------------------- *
   * Server call (real backend)
   * ---------------------------------------------------------------- */
  function kindOf(providerId) {
    if (connectionDetail && connectionDetail.kind) return connectionDetail.kind;
    return providerId === 'local' ? 'local' : 'cloud';
  }

  async function askServer(text, opts = {}) {
    const body = { message: text, lang };
    if (sessionId) body.sessionId = sessionId;
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    if (!data || !data.ok) throw new Error('bad-response');

    if (data.sessionId) {
      sessionId = String(data.sessionId);
      try { sessionStorage.setItem(SESSION_KEY, sessionId); } catch (e) { /* ignore */ }
    }

    if (data.mode === 'model') {
      aiConfigured = true;
      connectionDetail = { id: data.provider, kind: kindOf(data.provider), model: data.model || null };
      setConnection(connectionDetail.kind === 'local' ? 'local' : 'cloud', connectionDetail);
    } else if (data.agent) {
      // Verified local-PC task: the model was not involved, so leave the model
      // status untouched and refresh the agent chip instead.
      refreshAgent();
    } else if (data.degraded) {
      aiConfigured = true;              // a model is configured, it just failed
      setConnection('error');
    } else {
      aiConfigured = false;
      if (connectionState !== 'offline') setConnection('knowledge');
    }
    return {
      reply: data.reply || '',
      sources: enrichSources(data.sources),
      mode: data.mode === 'model' ? 'model' : 'knowledge',
      degraded: !!data.degraded
    };
  }

  function requestTurn(text) {
    const ctrl = new AbortController();
    activeController = ctrl;
    const timer = setTimeout(() => { ctrl.__timeout = true; try { ctrl.abort(); } catch (e) { /* ignore */ } }, REQUEST_TIMEOUT_MS);
    return askServer(text, { signal: ctrl.signal })
      .catch((e) => {
        if (ctrl.__timeout) { const err = new Error('timeout'); err.__timeout = true; throw err; }
        if (ctrl.__reason === 'user') { const err = new Error('aborted'); err.__aborted = true; throw err; }
        throw e;
      })
      .finally(() => {
        clearTimeout(timer);
        if (activeController === ctrl) activeController = null;
      });
  }

  function abortCurrent(reason) {
    if (activeController) {
      activeController.__reason = reason;
      try { activeController.abort(); } catch (e) { /* ignore */ }
    }
  }

  async function send(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    addUser(text);
    input.value = '';
    autosize();
    busy = true;
    sendBtn.disabled = true;
    stopSpeak();
    if (!VOICE.pc) setHolo('processing');
    const typing = addTyping(() => abortCurrent('user'));
    const forceLocal = quickLocal;
    quickLocal = false;

    try {
      await ensureIndex();
      const results = retrieve(text);
      const strong = results.length && results[0].score >= 6;
      const goLocal = forceLocal || aiConfigured === false || (strong && isLookupIntent(text)) || navigator.onLine === false;
      let payload;
      if (goLocal) {
        payload = localAnswer(text, results);
      } else {
        try {
          payload = await requestTurn(text);
          if (!payload.reply && results.length) payload = localAnswer(text, results);
        } catch (e) {
          if (e && e.__aborted) { typing.remove(); return; }
          if (navigator.onLine === false) setConnection('offline');
          else setConnection('error');
          if (results.length) payload = localAnswer(text, results);
          else if (aiConfigured === false) payload = localAnswer(text, []);
          else { typing.remove(); addRecoverableError(text); return; }
        }
      }
      typing.remove();
      addAi(payload.reply, payload.sources, payload.mode);
      history.push({ role: 'user', text });
      history.push({ role: 'ai', text: payload.reply });
      if (speakOut) speak(payload.reply);
    } catch (e) {
      typing.remove();
      addAi(t('errorGeneric'), [], 'error');
    } finally {
      busy = false;
      sendBtn.disabled = false;
      if (!VOICE.pc) setHolo('idle');
      refreshAgent();
    }
  }

  /* ---------------------------------------------------------------- *
   * Connection status (truthful, derived from /health)
   * ---------------------------------------------------------------- */
  function applyConnection() {
    const state = connectionState || 'knowledge';
    statusEl.textContent = t('conn_' + state);
    statusEl.setAttribute('data-mode', state);
    const detail = connectionDetail || {};
    if (detail.model) statusEl.title = detail.model; else statusEl.removeAttribute('title');
    noteEl.textContent = state === 'knowledge' ? t('note_setup') : t('note_' + state);
  }
  function setConnection(state, detail) {
    connectionState = state;
    if (detail !== undefined) connectionDetail = detail;
    applyConnection();
  }
  function restoreConnection() { applyConnection(); }

  async function checkHealth() {
    try {
      const res = await fetch(HEALTH_URL, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('health ' + res.status);
      const d = await res.json();
      if (!d || !d.ok) throw new Error('bad-health');
      const providers = Array.isArray(d.providers) ? d.providers : [];
      const live = providers.find((p) => p && p.available && (p.kind === 'cloud' || p.kind === 'local'));
      if (!live) {
        aiConfigured = false;
        connectionDetail = null;
        setConnection('knowledge');
        return { model: null };
      }
      aiConfigured = true;
      connectionDetail = { id: live.id, kind: live.kind, model: live.model };
      setConnection(live.kind === 'local' ? 'local' : 'cloud', connectionDetail);
      return { model: connectionDetail };
    } catch (e) {
      aiConfigured = null;
      setConnection(navigator.onLine === false ? 'offline' : 'error');
      return null;
    }
  }

  async function ensureStatus() {
    if (statusChecked) return;
    statusChecked = true;
    setConnection('connecting');
    await checkHealth();
    refreshAgent();
  }

  /* ---------------------------------------------------------------- *
   * Local PC agent (read-only status chip; never blocks the assistant)
   * ---------------------------------------------------------------- */
  const agentChipEl = panel.querySelector('[data-agent-chip]');
  const agentChipLabelEl = panel.querySelector('[data-agent-chip-label]');

  function setAgentState(state, label) {
    if (!agentChipEl) return;
    if (state === 'hidden') { agentChipEl.hidden = true; agentChipEl.removeAttribute('data-agent-state'); return; }
    agentChipEl.hidden = false;
    agentChipEl.setAttribute('data-agent-state', state);
    if (agentChipLabelEl) agentChipLabelEl.textContent = label || 'PC agent';
  }

  async function refreshAgent() {
    if (!agentChipEl) return;
    try {
      const res = await fetch(AGENT_URL, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('agent ' + res.status);
      const d = await res.json();
      if (!d || !d.available) { setAgentState('hidden'); return; }
      if (!d.online) { setAgentState('offline', 'PC agent offline'); return; }
      const first = (Array.isArray(d.agents) && d.agents[0]) || null;
      setAgentState('online', 'PC agent online' + (first && first.agentId ? ' · ' + first.agentId : ''));
    } catch (e) {
      // No agent endpoint (or the backend is down): stay quiet, chat still works.
      setAgentState('hidden');
    }
  }

  window.addEventListener('offline', () => setConnection('offline'));
  window.addEventListener('online', () => { statusChecked = false; ensureStatus(); });

  /* ---------------------------------------------------------------- *
   * Open / close
   * ---------------------------------------------------------------- */
  function activateCore() {
    if (reduce) return;
    if (heroCore) {
      heroCore.classList.add('is-activating');
      setTimeout(() => heroCore.classList.remove('is-activating'), 800);
    }
    if (heroCore && heroCore.globe && heroCore.globe.pulse) heroCore.globe.pulse();
  }

  function open() {
    if (!panel.hidden && panel.classList.contains('open')) return;
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('open'));
    openBtn.setAttribute('aria-expanded', 'true');
    html.classList.add('ai-locked');
    openedAt = Date.now();
    activateCore();
    if (heroCore && heroCore.globe && heroCore.globe.setSpeed) heroCore.globe.setSpeed(1.7);
    ensureIndex();
    ensureStatus();
    checkVoice();
    renderWelcome();
    renderQuick();
    setTimeout(() => { try { input.focus(); } catch (e) {} }, 70);
  }

  function close() {
    if (panel.hidden && !panel.classList.contains('open')) return;
    panel.classList.remove('open');
    openBtn.setAttribute('aria-expanded', 'false');
    html.classList.remove('ai-locked');
    stopSpeak();
    if (VOICE.pc || VOICE.mic) endVoice();
    if (heroCore && heroCore.globe && heroCore.globe.setSpeed) heroCore.globe.setSpeed(1);
    setTimeout(() => { panel.hidden = true; }, 300);
    try { openBtn.focus(); } catch (e) {}
  }

  /* ---------------------------------------------------------------- *
   * Composer
   * ---------------------------------------------------------------- */
  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(96, input.scrollHeight) + 'px';
  }
  input.addEventListener('input', autosize);
  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });

  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  clearBtn.addEventListener('click', () => {
    messagesEl.innerHTML = '';
    history = [];
    quickLocal = false;
    sessionId = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    renderWelcome();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('open')) close();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!panel.classList.contains('open')) return;
    if (Date.now() - openedAt < 260) return;
    if (panel.contains(e.target) || openBtn.contains(e.target)) return;
    close();
  });

  quickEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ai-quick-btn]');
    if (!btn) return;
    quickLocal = true;
    send(btn.textContent);
  });

  /* ---------------------------------------------------------------- *
   * Voice input
   * ---------------------------------------------------------------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    micBtn.hidden = false;
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => { listening = true; micBtn.setAttribute('aria-pressed', 'true'); noteEl.textContent = t('listening'); };
    recognition.onend = () => { listening = false; micBtn.setAttribute('aria-pressed', 'false'); restoreConnection(); };
    recognition.onerror = (ev) => {
      listening = false; micBtn.setAttribute('aria-pressed', 'false');
      if (ev && (ev.error === 'not-allowed' || ev.error === 'service-not-allowed')) noteEl.textContent = t('micDenied');
      else restoreConnection();
    };
    recognition.onresult = (ev) => {
      let finalText = '', interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      if (interim) input.value = interim;
      if (finalText) { input.value = (input.value.replace(interim, '').trim() + ' ' + finalText).trim(); input.value = finalText.trim(); autosize(); }
    };
    micBtn.addEventListener('click', () => {
      if (listening) { try { recognition.stop(); } catch (e) {} return; }
      try {
        recognition.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
        recognition.start();
      } catch (e) { noteEl.textContent = t('micUnsupported'); }
    });
  }

  /* ---------------------------------------------------------------- *
   * Voice output
   * ---------------------------------------------------------------- */
  const synth = window.speechSynthesis;
  let voice = null;
  function pickVoice() {
    if (!synth) return;
    const voices = synth.getVoices() || [];
    const want = lang === 'hi' ? 'hi' : 'en';
    voice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(want)) || voices.find((v) => v.default) || null;
  }
  if (synth) {
    pickVoice();
    if (typeof synth.onvoiceschanged !== 'undefined') synth.onvoiceschanged = pickVoice;
  }
  function speak(text) {
    if (!synth || !text) return;
    synth.cancel();
    const clean = String(text).replace(/https?:\/\/[^\s]+/g, '').replace(/[*•]/g, '').trim();
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean.slice(0, 480));
    u.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
    if (voice) u.voice = voice;
    u.rate = 1; u.pitch = 1;
    if (!VOICE.pc) {
      setHolo('speaking');
      u.onend = () => { if (!VOICE.pc) setHolo('idle'); };
      u.onerror = () => { if (!VOICE.pc) setHolo('idle'); };
    }
    synth.speak(u);
  }
  function stopSpeak() {
    if (synth) { try { synth.cancel(); } catch (e) {} }
    if (!VOICE.pc) setHolo('idle');
  }
  window.addEventListener('pagehide', stopSpeak);

  speakBtn.addEventListener('click', () => {
    speakOut = !speakOut;
    speakBtn.setAttribute('aria-pressed', speakOut ? 'true' : 'false');
    if (!speakOut) stopSpeak();
  });

  /* ---------------------------------------------------------------- *
   * Real voice — realtime speech-to-speech over WebRTC
   *
   * The browser never holds a provider key. It builds an SDP offer for its
   * peer connection and posts it to our backend (/api/voice/session), which
   * relays it to the provider using the server-side key and returns only the
   * SDP answer. Text chat is never disabled: any failure (no key, unsupported
   * browser, denied mic, dropped connection) leaves typing fully working and
   * shows an honest note.
   * ---------------------------------------------------------------- */
  const VOICE = {
    pc: null, dc: null, mic: null, remote: null,
    audioCtx: null, analyser: null, raf: 0,
    closeTimer: 0, readyTimer: 0, maxTimer: 0,
    state: 'idle', ready: false, closing: false, muted: false,
    info: null, checked: false
  };

  function supportsVoice() {
    try {
      return typeof window.RTCPeerConnection === 'function' &&
        !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    } catch (e) { return false; }
  }

  function setHolo(state) {
    if (heroCore && heroCore.globe && heroCore.globe.setState) {
      try { heroCore.globe.setState(state); } catch (e) { /* ignore */ }
    }
  }

  function voiceActive() {
    return VOICE.ready || VOICE.state === 'connecting' || VOICE.state === 'listening' ||
      VOICE.state === 'processing' || VOICE.state === 'speaking';
  }

  function refreshVoiceButtons() {
    const active = voiceActive();
    if (voiceBtn) {
      voiceBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
      voiceBtn.setAttribute('aria-label', active ? t('voiceStop') : t('voiceStart'));
      voiceBtn.classList.toggle('is-active', active);
      // Never disable it: a connecting/hung session must still be cancellable.
      voiceBtn.disabled = false;
    }
    if (voiceMuteBtn) {
      voiceMuteBtn.hidden = !active;
      voiceMuteBtn.setAttribute('aria-pressed', VOICE.muted ? 'true' : 'false');
      voiceMuteBtn.setAttribute('aria-label', VOICE.muted ? t('voiceUnmute') : t('voiceMute'));
    }
    if (voiceStateEl) {
      voiceStateEl.hidden = !active;
      if (voiceStateEl.hidden) voiceStateEl.textContent = '';
    }
  }

  function setVoiceState(state) {
    VOICE.state = state;
    if (state === 'speaking') startEnergy(); else stopEnergy();
    if (voiceStateEl && voiceActive()) {
      voiceStateEl.textContent = t('st_' + state) || t('voiceLabel');
      voiceStateEl.setAttribute('data-state', state);
    }
    setHolo(state === 'idle' ? 'idle' : state);
    refreshVoiceButtons();
  }

  async function checkVoice() {
    if (VOICE.checked) return VOICE.info;
    VOICE.checked = true;
    if (!supportsVoice()) { VOICE.info = { available: false }; if (voiceBtn) voiceBtn.hidden = true; return VOICE.info; }
    try {
      const res = await fetch(VOICE_URL, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('voice ' + res.status);
      const d = await res.json();
      VOICE.info = (d && d.ok && d.voice) ? d.voice : { available: false };
    } catch (e) { VOICE.info = { available: false }; }
    if (voiceBtn) voiceBtn.hidden = !(VOICE.info && VOICE.info.available);
    return VOICE.info;
  }

  function waitIce(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; pc.removeEventListener('icegatheringstatechange', onState); resolve(); };
      const onState = () => { if (pc.iceGatheringState === 'complete') finish(); };
      pc.addEventListener('icegatheringstatechange', onState);
      setTimeout(finish, 8000);
    });
  }

  function startEnergy() {
    if (reduce || !VOICE.remote || VOICE.analyser) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(VOICE.remote).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      VOICE.audioCtx = ctx; VOICE.analyser = analyser;
      const tick = () => {
        if (!VOICE.analyser) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        if (heroCore && heroCore.globe && heroCore.globe.energy) heroCore.globe.energy((sum / data.length) / 255);
        VOICE.raf = requestAnimationFrame(tick);
      };
      VOICE.raf = requestAnimationFrame(tick);
    } catch (e) { /* no audio graph — animation stays subtle */ }
  }

  function stopEnergy() {
    if (VOICE.raf) { cancelAnimationFrame(VOICE.raf); VOICE.raf = 0; }
    if (VOICE.audioCtx) { try { VOICE.audioCtx.close(); } catch (e) {} VOICE.audioCtx = null; }
    VOICE.analyser = null;
    if (heroCore && heroCore.globe && heroCore.globe.energy) heroCore.globe.energy(0);
  }

  function onVoiceEvent(evt) {
    let e;
    try { e = JSON.parse(evt.data); } catch (err) { return; }
    if (!e || !e.type) return;
    switch (e.type) {
      case 'session.started':
        VOICE.ready = true;
        clearTimeout(VOICE.readyTimer); VOICE.readyTimer = 0;
        setVoiceState('listening');
        break;
      case 'session.closed':
        VOICE.closing = true;
        endVoice(t('voiceEnded'));
        break;      case 'input_audio_buffer.speech_started':
        if (VOICE.ready) setVoiceState('listening');
        break;
      case 'input_audio_buffer.speech_stopped':
        if (VOICE.ready) setVoiceState('processing');
        break;
      case 'response.created':
        if (VOICE.ready) setVoiceState('processing');
        break;
      case 'response.output_audio.started':
      case 'output_audio_buffer.started':
        if (VOICE.ready) setVoiceState('speaking');
        break;
      case 'response.output_audio.done':
      case 'output_audio_buffer.stopped':
      case 'response.done':
        if (VOICE.ready) setVoiceState('listening');
        break;
      case 'error':
        // A failing session must not keep the microphone live — tear it down.
        endVoice(t('voiceError'));
        break;
      default: break;
    }
  }

  function cleanupVoice() {
    clearTimeout(VOICE.readyTimer); clearTimeout(VOICE.closeTimer); clearTimeout(VOICE.maxTimer);
    VOICE.readyTimer = VOICE.closeTimer = VOICE.maxTimer = 0;
    stopEnergy();
    try { if (VOICE.mic) VOICE.mic.getTracks().forEach((tr) => tr.stop()); } catch (e) { /* ignore */ }
    try { if (VOICE.dc) VOICE.dc.close(); } catch (e) { /* ignore */ }
    try { if (VOICE.pc) VOICE.pc.close(); } catch (e) { /* ignore */ }
    if (voiceAudio) { try { voiceAudio.srcObject = null; voiceAudio.pause(); } catch (e) {} }
    VOICE.pc = VOICE.dc = VOICE.mic = VOICE.remote = null;
    VOICE.ready = false; VOICE.closing = false; VOICE.muted = false;
    refreshVoiceButtons();
  }

  function endVoice(message) {
    const wasActive = voiceActive();
    cleanupVoice();
    setVoiceState('idle');
    if (wasActive && message) noteEl.textContent = message;
  }

  async function startVoice() {
    if (VOICE.pc || VOICE.state === 'connecting') return;
    stopSpeak();
    const info = await checkVoice();
    if (!supportsVoice()) { noteEl.textContent = t('voiceUnsupported'); return; }
    if (!info || !info.available) { noteEl.textContent = t('voiceUnavailable'); return; }

    setVoiceState('connecting');
    let mic;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      setVoiceState('idle');
      noteEl.textContent = (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) ? t('voiceMicDenied') : t('voiceFailed');
      return;
    }

    let pc;
    try { pc = new RTCPeerConnection(); }
    catch (e) { try { mic.getTracks().forEach((tr) => tr.stop()); } catch (e2) {} setVoiceState('idle'); noteEl.textContent = t('voiceUnsupported'); return; }

    VOICE.pc = pc; VOICE.mic = mic; VOICE.ready = false; VOICE.closing = false; VOICE.muted = false;
    refreshVoiceButtons();

    pc.addEventListener('track', (ev) => {
      const stream = (ev.streams && ev.streams[0]) || new MediaStream([ev.track]);
      VOICE.remote = stream;
      if (voiceAudio) { voiceAudio.srcObject = stream; voiceAudio.play().catch(() => { noteEl.textContent = t('voicePlay'); }); }
    });
    pc.addEventListener('connectionstatechange', () => {
      const s = pc.connectionState;
      if ((s === 'failed' || s === 'disconnected' || s === 'closed') && VOICE.pc === pc) endVoice(t('voiceFailed'));
    });
    for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);

    VOICE.dc = pc.createDataChannel('oai-events');
    VOICE.dc.addEventListener('message', onVoiceEvent);
    // The remote close is the authoritative "we are done" signal — including the
    // close WE asked for. Never suppress it, or the mic stays on.
    VOICE.dc.addEventListener('close', () => { if (VOICE.pc === pc) endVoice(VOICE.closing ? null : t('voiceEnded')); });

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIce(pc);
      const res = await fetch(VOICE_URL + '/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sdp: pc.localDescription && pc.localDescription.sdp })
      });
      if (!res.ok) { noteEl.textContent = res.status === 503 ? t('voiceUnavailable') : t('voiceFailed'); endVoice(); return; }
      const data = await res.json();
      if (!data || !data.ok || !data.session || !data.session.sdp) throw new Error('bad-voice-response');
      await pc.setRemoteDescription({ type: 'answer', sdp: data.session.sdp });
      const maxS = Number(data.session.maxSessionSeconds) || 0;
      if (maxS > 0) VOICE.maxTimer = setTimeout(() => endVoice(t('voiceTimedOut')), maxS * 1000);
      VOICE.readyTimer = setTimeout(() => { if (!VOICE.ready && VOICE.pc === pc) endVoice(t('voiceFailed')); }, 25000);
    } catch (e) {
      noteEl.textContent = t('voiceFailed');
      endVoice();
    }
  }

  function stopVoice() {
    const dc = VOICE.dc;
    if (dc && dc.readyState === 'open') {
      VOICE.closing = true;
      setVoiceState('processing');
      noteEl.textContent = t('stopping');
      try { dc.send(JSON.stringify({ type: 'session.close' })); } catch (e) { /* ignore */ }
      // Grace period only. The remote close event normally lands first; this
      // timer is a backstop so a silent remote can never keep the mic on.
      VOICE.closeTimer = setTimeout(() => endVoice(t('voiceEnded')), 2500);
      return;
    }
    endVoice(t('voiceEnded'));
  }

  function toggleVoiceMute() {
    if (!VOICE.mic) return;
    VOICE.muted = !VOICE.muted;
    try { for (const tr of VOICE.mic.getAudioTracks()) tr.enabled = !VOICE.muted; } catch (e) { /* ignore */ }
    refreshVoiceButtons();
    noteEl.textContent = VOICE.muted ? t('voiceMute') : t('st_listening');
  }

  if (voiceBtn) voiceBtn.addEventListener('click', () => { if (voiceActive()) stopVoice(); else startVoice(); });
  if (voiceMuteBtn) voiceMuteBtn.addEventListener('click', toggleVoiceMute);
  window.addEventListener('pagehide', () => { if (VOICE.pc || VOICE.mic) cleanupVoice(); });

  /* ---------------------------------------------------------------- *
   * Language
   * ---------------------------------------------------------------- */
  if (langSel) {
    langSel.addEventListener('change', () => {
      lang = langSel.value === 'hi' ? 'hi' : 'en';
      input.placeholder = t('placeholder');
      renderQuick();
      pickVoice();
      if (messagesEl.childElementCount <= 2) { messagesEl.innerHTML = ''; renderWelcome(); }
    });
  }
  input.placeholder = t('placeholder');

  /* ---------------------------------------------------------------- *
   * Test / integration hooks
   * ---------------------------------------------------------------- */
  window.__SOLUTION_AI__ = {
    open, close, send,
    refresh: () => { statusChecked = false; VOICE.checked = false; return Promise.all([ensureStatus(), checkVoice()]); },
    voiceAvailable: () => !!(VOICE.info && VOICE.info.available),
    voiceState: () => ({
      state: VOICE.state,
      ready: VOICE.ready,
      muted: VOICE.muted,
      active: !!VOICE.pc,
      supported: supportsVoice(),
      holo: (heroCore && heroCore.globe && heroCore.globe.state) ? heroCore.globe.state().state : null
    }),
    startVoice, stopVoice,
    state() {
      return {
        open: panel.classList.contains('open'),
        busy, aiConfigured, lang,
        connection: connectionState,
        provider: connectionDetail,
        sessionId,
        base: BASE,
        entries: entries ? entries.length : 0,
        voice: VOICE.state,
        voiceAvailable: !!(VOICE.info && VOICE.info.available),
        holo: (heroCore && heroCore.globe && heroCore.globe.state) ? heroCore.globe.state().state : null
      };
    }
  };
})();
