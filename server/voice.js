/* ==========================================================================
   server/voice.js — voice session abstraction (provider-agnostic)

   Two pieces live here:

   1. createVoiceSession() — the Milestone 1 state machine
      (idle → listening → processing → speaking → idle, any → error). It is
      interruptible and remains provider-neutral.

   2. createVoiceService() — the Milestone 3 WebRTC session relay. The browser
      sends an SDP offer; the server adds session config and relays it to the
      realtime provider using the permanent server key, returning ONLY the SDP
      answer. No permanent key, audio, token or transcript ever reaches the
      browser or the logs.

   States: idle → listening → processing → speaking → idle  (any → error)
   A session is interruptible: `stop()` from any state returns to idle.
   ========================================================================== */
'use strict';

const { AppError, ValidationError, ProviderError, TimeoutError } = require('./errors');
const { scrubText } = require('./security');

const VOICE_STATES = ['idle', 'listening', 'processing', 'speaking', 'error'];

function createAdapterSlot(name) {
  return {
    name,
    /** @type {null|Function} */
    impl: null,
    register(fn) { this.impl = fn; },
    async run(...args) {
      if (!this.impl) {
        const e = new Error(`${name} adapter is not configured.`);
        e.code = 'not_implemented';
        throw e;
      }
      return this.impl(...args);
    }
  };
}

/**
 * @param {{ cfg: object, logger: object, onTranscript?: Function, respond?: Function }} opts
 */
function createVoiceSession(opts = {}) {
  const log = opts.logger;
  let state = 'idle';
  const listeners = new Set();
  const stt = createAdapterSlot('stt');
  const tts = createAdapterSlot('tts');

  function setState(next, detail) {
    if (!VOICE_STATES.includes(next)) return;
    state = next;
    const evt = { type: 'state', state, detail: detail || null, at: Date.now() };
    for (const cb of listeners) { try { cb(evt); } catch (e) { /* isolate */ } }
    if (log) log.debug('voice_state', { state });
  }

  /** Feed a recognized transcript (from any STT source) into the pipeline. */
  async function submitTranscript(text) {
    setState('processing');
    try {
      const reply = opts.respond ? await opts.respond(String(text || '')) : '';
      if (reply) { setState('speaking', { text: reply }); }
      setState('idle');
      if (opts.onTranscript) opts.onTranscript({ text: String(text || ''), reply });
      return reply;
    } catch (e) {
      setState('error', { message: e && e.message });
      throw e;
    }
  }

  return {
    get state() { return state; },
    states: VOICE_STATES,
    stt, tts,
    /** @param {(evt:object)=>void} cb */
    on(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    start() { setState('listening'); },
    mute(on) { if (on) setState('idle', { muted: true }); },
    stop() { setState('idle', { stopped: true }); },
    submitTranscript
  };
}

/**
 * Real (cloud) voice service — WebRTC session relay.
 *
 * The browser builds an SDP offer for its peer connection and posts it to our
 * API. This service adds the server-side session configuration and relays the
 * offer to the provider's realtime endpoint using the PERMANENT server key,
 * then returns only the SDP answer. The permanent key never reaches the browser
 * and no audio, token or transcript is ever logged here.
 *
 * `fetchImpl` is injectable for tests (defaults to global fetch).
 *
 * @param {{ cfg: object, logger?: object, fetchImpl?: Function }} opts
 */
function createVoiceService(opts = {}) {
  const cfg = opts.cfg;
  const log = opts.logger;
  const vcfg = cfg.voice;
  const doFetch = opts.fetchImpl || fetch;
  const secrets = [vcfg && vcfg.apiKey].filter(Boolean);
  const voiceSet = new Set((vcfg && vcfg.voices) || []);

  function describe() {
    return {
      enabled: !!(cfg.features && cfg.features.voice),
      provider: vcfg.provider,
      model: vcfg.model,
      voice: vcfg.voice,
      voices: (vcfg.voices || []).slice(),
      available: !!vcfg.available,
      configured: !!vcfg.apiKey,
      requireAuth: !!vcfg.requireAuth,
      maxSessionSeconds: vcfg.maxSessionSeconds,
      transport: 'webrtc'
    };
  }

  function normalizeVoice(requested) {
    if (requested === undefined || requested === null || requested === '') return vcfg.voice;
    const name = String(requested).toLowerCase().trim();
    if (!voiceSet.has(name)) throw new ValidationError('Requested voice is not available.');
    return name;
  }

  function validateSdp(sdp) {
    if (typeof sdp !== 'string' || sdp.trim().length < 8) throw new ValidationError('An SDP offer is required.');
    const s = sdp.trim();
    if (s.length > 200000) throw new ValidationError('SDP offer is too large.');
    if (!/^v=0/m.test(s) || !/^m=/m.test(s)) throw new ValidationError('SDP offer is not valid.');
    return s;
  }

  /**
   * @param {{ sdp: string, voice?: string, principal?: object }} req
   * @returns {Promise<{ sdp:string, voice:string, model:string, maxSessionSeconds:number }>}
   */
  async function createSession(req = {}) {
    if (!vcfg.available) throw new AppError('voice_unavailable', 'Voice is not available.', 503);
    const offer = validateSdp(req.sdp);
    const chosenVoice = normalizeVoice(req.voice);

    const sessionConfig = JSON.stringify({
      type: 'realtime',
      model: vcfg.model,
      audio: { output: { voice: chosenVoice } },
      instructions: vcfg.instructions
    });
    const fd = new FormData();
    fd.set('sdp', offer);
    fd.set('session', sessionConfig);

    const headers = { Authorization: `Bearer ${vcfg.apiKey}` };
    if (vcfg.safetyIdentifier) headers['OpenAI-Safety-Identifier'] = vcfg.safetyIdentifier;

    let res;
    try {
      res = await doFetch(`${vcfg.baseUrl}/realtime/calls`, {
        method: 'POST', headers, body: fd, signal: AbortSignal.timeout(vcfg.timeoutMs)
      });
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) throw new TimeoutError('Voice provider timed out.');
      throw new ProviderError('Could not reach the voice provider.');
    }

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      if (log) log.warn('voice_session_failed', { status: res.status });
      throw new ProviderError('Voice provider returned an error.', { status: res.status, detail: scrubText(text.slice(0, 200), secrets) });
    }
    const answer = String(text || '').trim();
    if (!/^v=0/m.test(answer)) throw new ProviderError('Voice provider returned an unexpected session response.');
    return { sdp: answer, voice: chosenVoice, model: vcfg.model, maxSessionSeconds: vcfg.maxSessionSeconds };
  }

  return { describe, createSession, voices: (vcfg.voices || []).slice() };
}

module.exports = { createVoiceSession, createVoiceService, VOICE_STATES, createAdapterSlot };
