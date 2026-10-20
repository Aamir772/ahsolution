/* ==========================================================================
   server/providers.js — model-provider abstraction + routing

   A provider is a small object:
     { id, kind:'cloud'|'local'|'none', model, available(), chat(req) }
   chat(req) → { text, toolCalls[], usage, model, provider }

   Supported:
     openai-compatible — OpenAI, Groq, OpenRouter, vLLM, Ollama, LM Studio,
                          anything speaking the /chat/completions API
     gemini            — Google Generative Language API (text)
     none              — deterministic, no network (default; safe dev)

   The website/frontend never sees a key. Routing supports cloud-only,
   local-only, cloud-first and local-first so the assistant degrades gracefully
   when one side is unavailable.
   ========================================================================== */
'use strict';

const { ProviderError, TimeoutError, ValidationError } = require('./errors');
const { scrubText } = require('./security');

function combineSignals(timeoutMs, external) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([external, timeout]) : timeout;
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && m.role && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content }));
}

/* ------------------------------------------------ openai-compatible provider */

function createOpenAICompatible({ id, kind, model, baseUrl, apiKey, timeoutMs, secrets }) {
  return {
    id, kind, model,
    available() { return !!baseUrl && (kind === 'local' ? true : !!apiKey); },
    /** Reachability probe so we never claim a local fallback exists unless it does. */
    async probe() {
      if (!baseUrl) return false;
      if (kind !== 'local') return this.available();
      try {
        const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(1500) });
        return res.ok;
      } catch (e) { return false; }
    },
    async chat({ messages, tools, maxTokens, signal }) {
      if (!model) throw new ValidationError(`No model configured for provider "${id}".`);
      const body = {
        model,
        messages: normalizeMessages(messages),
        max_tokens: maxTokens
      };
      if (Array.isArray(tools) && tools.length) {
        body.tools = tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.schema || { type: 'object', properties: {} } }
        }));
        body.tool_choice = 'auto';
      }
      let res;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          body: JSON.stringify(body),
          signal: combineSignals(timeoutMs, signal)
        });
      } catch (e) {
        if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) throw new TimeoutError('Model request timed out.');
        throw new ProviderError('Could not reach model provider.', { provider: id });
      }
      if (!res.ok) {
        const raw = await res.text().catch(() => '');
        throw new ProviderError('Model provider returned an error.', { provider: id, status: res.status, detail: scrubText(raw.slice(0, 300), secrets) });
      }
      const json = await res.json().catch(() => null);
      const choice = json && json.choices && json.choices[0];
      const msg = (choice && choice.message) || {};
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function && tc.function.name,
        arguments: safeJson(tc.function && tc.function.arguments)
      })) : [];
      return { text: msg.content || '', toolCalls, usage: json && json.usage, model: json && json.model || model, provider: id };
    }
  };
}

function safeJson(s) { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } }

/* -------------------------------------------------------------- gemini provider */

function createGemini({ id, model, baseUrl, apiKey, timeoutMs, secrets }) {
  const base = baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  return {
    id, kind: 'cloud', model,
    available() { return !!apiKey && !!model; },
    async probe() { return this.available(); },
    async chat({ messages, maxTokens, signal }) {
      const contents = normalizeMessages(messages).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
      let res;
      try {
        res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: maxTokens } }),
          signal: combineSignals(timeoutMs, signal)
        });
      } catch (e) {
        if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) throw new TimeoutError('Model request timed out.');
        throw new ProviderError('Could not reach model provider.', { provider: id });
      }
      if (!res.ok) {
        const raw = await res.text().catch(() => '');
        throw new ProviderError('Model provider returned an error.', { provider: id, status: res.status, detail: scrubText(raw.slice(0, 300), secrets) });
      }
      const json = await res.json().catch(() => null);
      const cand = json && json.candidates && json.candidates[0];
      const text = cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || '').join('') : '';
      return { text, toolCalls: [], usage: json && json.usageMetadata, model, provider: id };
    }
  };
}

/* ------------------------------------------------------------------ none provider */

function createNoneProvider() {
  return {
    id: 'none', kind: 'none', model: 'none',
    available() { return true; },
    async probe() { return true; },
    async chat() {
      return { text: '', toolCalls: [], usage: null, model: 'none', provider: 'none' };
    }
  };
}

/* --------------------------------------------------------------------- routing */

function isLocalHost(urlish) {
  try { const u = new URL(urlish); return ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(u.hostname); }
  catch (e) { return false; }
}

/** Kind is driven by provider name; only openai-compatible may be local or cloud. */
function kindFor(name, baseUrl) {
  if (name === 'local') return 'local';
  if (name === 'openai' || name === 'gemini') return 'cloud';
  if (name === 'openai-compatible') return isLocalHost(baseUrl) ? 'local' : 'cloud';
  return 'none';
}

function createProviders(cfg, logger) {
  const secrets = [cfg.provider.apiKey].filter(Boolean);
  const list = [];
  const primaryKind = kindFor(cfg.provider.name, cfg.provider.baseUrl);

  if (cfg.provider.name === 'openai' || cfg.provider.name === 'openai-compatible') {
    list.push(createOpenAICompatible({
      id: cfg.provider.name, kind: primaryKind, model: cfg.provider.model,
      baseUrl: cfg.provider.baseUrl, apiKey: primaryKind === 'local' ? '' : cfg.provider.apiKey, timeoutMs: cfg.provider.timeoutMs, secrets
    }));
  } else if (cfg.provider.name === 'gemini') {
    list.push(createGemini({ id: 'gemini', model: cfg.provider.model, baseUrl: cfg.provider.baseUrl, apiKey: cfg.provider.apiKey, timeoutMs: cfg.provider.timeoutMs, secrets }));
  } else if (cfg.provider.name === 'local') {
    list.push(createOpenAICompatible({
      id: 'local', kind: 'local', model: cfg.provider.localModel || cfg.provider.model,
      baseUrl: cfg.provider.localBaseUrl, apiKey: '', timeoutMs: cfg.provider.timeoutMs, secrets
    }));
  }

  if (cfg.provider.localEnabled && cfg.provider.name !== 'local') {
    list.push(createOpenAICompatible({
      id: 'local', kind: 'local', model: cfg.provider.localModel,
      baseUrl: cfg.provider.localBaseUrl, apiKey: '', timeoutMs: cfg.provider.timeoutMs, secrets
    }));
  }

  list.push(createNoneProvider());

  const get = (id) => list.find((p) => p.id === id) || null;

  /** Ordered candidate chain for the configured routing policy. */
  function chain() {
    const cloud = list.filter((p) => p.kind === 'cloud' && p.available());
    const local = list.filter((p) => p.kind === 'local' && p.available());
    const none = list.filter((p) => p.kind === 'none');
    switch (cfg.provider.routing) {
      case 'cloud-only': return [...cloud, ...none];
      case 'local-only': return [...local, ...none];
      case 'local-first': return [...local, ...cloud, ...none];
      case 'cloud-first':
      default: return [...cloud, ...local, ...none];
    }
  }

  /** First available provider per routing (always resolves — falls back to none). */
  function select() { return chain()[0] || get('none'); }

  async function chat(req) {
    const order = chain();
    let lastErr = null;
    for (const p of order) {
      if (p.kind === 'none') return p.chat(req);
      try {
        const out = await p.chat(req);
        return out;
      } catch (e) {
        lastErr = e;
        if (logger) logger.warn('provider_failed_trying_next', { provider: p.id, message: e && e.message });
      }
    }
    if (lastErr) throw lastErr;
    return get('none').chat(req);
  }

  function describe() {
    return list.map((p) => ({ id: p.id, kind: p.kind, model: p.model, available: p.available() }));
  }

  /** Configuration-level availability plus a live reachability probe for local providers. */
  async function describeLive() {
    return Promise.all(list.map(async (p) => {
      let available = p.available();
      if (available && p.kind === 'local' && typeof p.probe === 'function') {
        try { available = await p.probe(); } catch (e) { available = false; }
      }
      return { id: p.id, kind: p.kind, model: p.model, available, configured: p.available() };
    }));
  }

  return { list, get, select, chat, describe, describeLive, hasModel: () => list.some((p) => p.kind !== 'none' && p.available()) };
}

module.exports = { createProviders, createOpenAICompatible, createGemini, createNoneProvider };
