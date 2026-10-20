/* ==========================================================================
   server/agent-framing.js — newline-delimited JSON framing over a stream

   The agent transport is a persistent outbound socket (TCP, or TLS for remote
   connections). Messages are NDJSON: one JSON object per line, terminated by
   "\n". This is deliberately simple and dependency-free, and is the framing
   used by both the backend hub and the agent client.

   The decoder enforces a hard per-line byte cap so a malformed/oversized
   message can never exhaust memory; on overflow the buffer is dropped and
   onError is invoked (the caller closes the connection).
   ========================================================================== */
'use strict';

const DEFAULT_MAX_BYTES = 262144; // 256 KiB per message

/**
 * @param {{ maxBytes?:number, onLine:(line:string)=>void, onError?:(err:Error)=>void }} opts
 * @returns {(chunk:Buffer|string)=>void}
 */
function createLineDecoder({ maxBytes = DEFAULT_MAX_BYTES, onLine, onError } = {}) {
  let buf = '';
  let overflow = false;
  const overflowErr = () => Object.assign(new Error('Agent message exceeds the maximum size.'), { code: 'message_too_large' });

  return function push(chunk) {
    if (overflow) return;
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line.trim()) onLine(line);
    }
    if (Buffer.byteLength(buf, 'utf8') > maxBytes) {
      overflow = true;
      buf = '';
      if (onError) onError(overflowErr());
    }
  };
}

/** Encode one message as a single NDJSON line. */
function encodeLine(obj) {
  return JSON.stringify(obj) + '\n';
}

module.exports = { createLineDecoder, encodeLine, DEFAULT_MAX_BYTES };
