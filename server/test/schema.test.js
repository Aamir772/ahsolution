'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateArgs } = require('../tools/schema');

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string', required: true, maxLength: 5 },
    count: { type: 'integer', min: 1, max: 10, default: 3 },
    mode: { type: 'string', enum: ['a', 'b'] },
    tags: { type: 'array', maxItems: 2, items: { type: 'string' } }
  },
  additionalProperties: false
};

test('accepts valid input and applies defaults', () => {
  const r = validateArgs({ name: 'abc' }, schema);
  assert.equal(r.ok, true);
  assert.equal(r.value.count, 3);
});

test('rejects missing required fields', () => {
  const r = validateArgs({}, schema);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /name is required/);
});

test('rejects wrong types, bounds, enums, extra keys', () => {
  assert.equal(validateArgs({ name: 5 }, schema).ok, false);
  assert.equal(validateArgs({ name: 'toolong' }, schema).ok, false);
  assert.equal(validateArgs({ name: 'ok', count: 50 }, schema).ok, false);
  assert.equal(validateArgs({ name: 'ok', mode: 'c' }, schema).ok, false);
  assert.equal(validateArgs({ name: 'ok', tags: ['x', 'y', 'z'] }, schema).ok, false);
  assert.equal(validateArgs({ name: 'ok', extra: 1 }, schema).ok, false);
});

test('non-object arguments are rejected', () => {
  assert.equal(validateArgs('hello', schema).ok, false);
  assert.equal(validateArgs([1, 2], schema).ok, false);
});
