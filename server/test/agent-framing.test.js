'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLineDecoder, encodeLine, DEFAULT_MAX_BYTES } = require('../agent-framing');

function collect(maxBytes) {
  const lines = [];
  const errors = [];
  const push = createLineDecoder({ maxBytes, onLine: (l) => lines.push(l), onError: (e) => errors.push(e) });
  return { lines, errors, push };
}

test('the decoder emits one message per line, across chunk boundaries', () => {
  const { lines, push } = collect();
  push('{"a":1}\n{"b":2');
  assert.equal(lines.length, 1);
  push('}\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[1]), { b: 2 });
});

test('the decoder handles CRLF, partial JSON, several messages in one chunk and blanks', () => {
  const { lines, push } = collect();
  push('{"x":1}\r\n\r\n\n{"y":2}\n{"z":3}\n');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => JSON.parse(l)), [{ x: 1 }, { y: 2 }, { z: 3 }]);
  assert.deepEqual(lines, ['{"x":1}', '{"y":2}', '{"z":3}'], 'CR is stripped from line endings');
});

test('the decoder accepts string and Buffer chunks', () => {
  const { lines, push } = collect();
  push(Buffer.from('{"n":1}\n', 'utf8'));
  push('{"n":2}\n');
  assert.deepEqual(lines.map((l) => JSON.parse(l).n), [1, 2]);
});

test('an oversized message trips the byte cap once and the connection is dropped', () => {
  const { lines, errors, push } = collect(64);
  push('{"payload":"' + 'x'.repeat(500));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'message_too_large');
  assert.equal(lines.length, 0);
  // the decoder stops accepting data after an overflow
  push('{"a":1}\n');
  assert.equal(errors.length, 1);
  assert.equal(lines.length, 0);
});

test('complete messages received before an overflow are still delivered', () => {
  const { lines, errors, push } = collect(64);
  push('{"ok":true}\n');
  push('y'.repeat(200));
  assert.deepEqual(lines, ['{"ok":true}']);
  assert.equal(errors.length, 1);
});

test('encodeLine emits a single newline-terminated JSON line', () => {
  const s = encodeLine({ a: 1, b: 'two' });
  assert.equal(s.endsWith('\n'), true);
  assert.equal(s.split('\n').filter(Boolean).length, 1);
  assert.deepEqual(JSON.parse(s), { a: 1, b: 'two' });
  assert.equal(JSON.stringify(JSON.parse(s)), JSON.stringify({ a: 1, b: 'two' }), 'round-trips without key drift');
});

test('the default per-message cap is 256 KiB', () => {
  assert.equal(DEFAULT_MAX_BYTES, 262144);
});
