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
  const FN = '/.netlify/functions/solution-ai-chat';
  const INDEX_URL = 'assets/data/ai-index.json';

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
      noteKnowledge: 'Answers come from AH Solution content. Add an AI key for richer replies.',
      noteAi: 'Answers use AH Solution content, with a light AI assist.',
      you: 'You',
      listening: 'Listening…',
      micDenied: 'Microphone permission was blocked.',
      micUnsupported: 'Voice input is not supported in this browser.',
      more: 'Explore more',
      guide: 'Guide',
      page: 'Page',
      video: 'YouTube video',
      short: 'YouTube Short'
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
      noteKnowledge: 'जवाब AH Solution कंटेंट से हैं। बेहतर जवाब के लिए AI की ज़रूरत नहीं — जानकारी साइट से आती है।',
      noteAi: 'जवाब AH Solution कंटेंट और हल्की AI सहायता से।',
      you: 'आप',
      listening: 'सुन रहा हूँ…',
      micDenied: 'माइक्रोफ़ोन की अनुमति रोक दी गई।',
      micUnsupported: 'इस ब्राउज़र में वॉइस इनपुट उपलब्ध नहीं है।',
      more: 'और देखें',
      guide: 'गाइड',
      page: 'पेज',
      video: 'YouTube वीडियो',
      short: 'YouTube Short'
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

  function addTyping() {
    const el = document.createElement('div');
    el.className = 'ai-msg ai-msg--ai';
    el.innerHTML = '<span class="ai-msg__avatar" aria-hidden="true"></span>' +
      '<div class="ai-msg__bubble"><span class="ai-typing" role="status" aria-label="' + esc(t('thinking')) + '"><i></i><i></i><i></i></span></div>';
    messagesEl.appendChild(el);
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
   * Server call
   * ---------------------------------------------------------------- */
  async function askServer(text) {
    const body = {
      message: text,
      lang,
      history: history.slice(-3).map((m) => ({ role: m.role, text: m.text }))
    };
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    if (!data || !data.ok) throw new Error('bad-response');
    if (data.mode === 'ai') { aiConfigured = true; setStatus('ai'); }
    else if (data.mode === 'knowledge') { setStatus('knowledge'); }
    return { reply: data.reply || '', sources: data.sources || [], mode: data.mode || 'knowledge' };
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
    const typing = addTyping();
    const forceLocal = quickLocal;
    quickLocal = false;

    try {
      await ensureIndex();
      const results = retrieve(text);
      const strong = results.length && results[0].score >= 6;
      let payload;
      if (forceLocal || aiConfigured === false || (strong && isLookupIntent(text)) || !navigator.onLine) {
        payload = localAnswer(text, results);
      } else {
        try {
          payload = await askServer(text);
          if (!payload.reply && results.length) payload = localAnswer(text, results);
        } catch (e) {
          if (results.length) payload = localAnswer(text, results);
          else if (aiConfigured === false) payload = localAnswer(text, []);
          else throw e;
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
    }
  }

  /* ---------------------------------------------------------------- *
   * Status
   * ---------------------------------------------------------------- */
  function setStatus(mode) {
    if (mode === 'ai') { statusEl.textContent = t('aiMode'); statusEl.setAttribute('data-mode', 'ai'); noteEl.textContent = t('noteAi'); }
    else { statusEl.textContent = t('knowledgeMode'); statusEl.setAttribute('data-mode', 'knowledge'); noteEl.textContent = t('noteKnowledge'); }
  }
  async function ensureStatus() {
    if (aiConfigured !== null) { setStatus(aiConfigured ? 'ai' : 'knowledge'); return; }
    statusEl.textContent = t('ready'); statusEl.removeAttribute('data-mode');
    try {
      const res = await fetch(FN, { method: 'GET', headers: { Accept: 'application/json' } });
      const d = await res.json();
      aiConfigured = !!(d && d.aiConfigured);
    } catch (e) {
      aiConfigured = false;
    }
    setStatus(aiConfigured ? 'ai' : 'knowledge');
  }

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
    recognition.onend = () => { listening = false; micBtn.setAttribute('aria-pressed', 'false'); setStatus(aiConfigured ? 'ai' : 'knowledge'); };
    recognition.onerror = (ev) => {
      listening = false; micBtn.setAttribute('aria-pressed', 'false');
      if (ev && (ev.error === 'not-allowed' || ev.error === 'service-not-allowed')) noteEl.textContent = t('micDenied');
      setStatus(aiConfigured ? 'ai' : 'knowledge');
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
    synth.speak(u);
  }
  function stopSpeak() { if (synth) { try { synth.cancel(); } catch (e) {} } }
  window.addEventListener('pagehide', stopSpeak);

  speakBtn.addEventListener('click', () => {
    speakOut = !speakOut;
    speakBtn.setAttribute('aria-pressed', speakOut ? 'true' : 'false');
    if (!speakOut) stopSpeak();
  });

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
    state() {
      return { open: panel.classList.contains('open'), busy, aiConfigured, lang, entries: entries ? entries.length : 0 };
    }
  };
})();
