/* ==========================================================================
   server/tools/schema.js — tiny, dependency-free argument validator

   A deliberately small subset of JSON Schema: enough to validate every tool
   argument before it reaches a handler. Model-supplied arguments are untrusted
   and MUST pass through here.
   ========================================================================== */
'use strict';

function typeOf(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v; // 'string' | 'number' | 'boolean' | 'object' | 'undefined'
}

function validate(value, schema, path, errors) {
  const s = schema || {};
  const t = s.type;
  const here = path || 'value';

  if (value === undefined || value === null) {
    if (s.default !== undefined) return s.default;
    if (s.required) { errors.push(`${here} is required`); return undefined; }
    return value;
  }

  if (t === 'string') {
    if (typeof value !== 'string') { errors.push(`${here} must be a string`); return undefined; }
    if (s.maxLength && value.length > s.maxLength) errors.push(`${here} exceeds maxLength ${s.maxLength}`);
    if (s.minLength && value.length < s.minLength) errors.push(`${here} is shorter than minLength ${s.minLength}`);
    if (s.pattern && !new RegExp(s.pattern).test(value)) errors.push(`${here} does not match pattern`);
    if (s.enum && !s.enum.includes(value)) errors.push(`${here} must be one of: ${s.enum.join(', ')}`);
    return value;
  }
  if (t === 'integer' || t === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) { errors.push(`${here} must be a number`); return undefined; }
    if (t === 'integer' && !Number.isInteger(value)) errors.push(`${here} must be an integer`);
    if (s.min !== undefined && value < s.min) errors.push(`${here} must be >= ${s.min}`);
    if (s.max !== undefined && value > s.max) errors.push(`${here} must be <= ${s.max}`);
    return value;
  }
  if (t === 'boolean') {
    if (typeof value !== 'boolean') { errors.push(`${here} must be a boolean`); return undefined; }
    return value;
  }
  if (t === 'array') {
    if (!Array.isArray(value)) { errors.push(`${here} must be an array`); return undefined; }
    if (s.maxItems && value.length > s.maxItems) errors.push(`${here} exceeds maxItems ${s.maxItems}`);
    if (s.items) return value.map((v, i) => validate(v, s.items, `${here}[${i}]`, errors));
    return value;
  }
  if (t === 'object') {
    if (typeOf(value) !== 'object') { errors.push(`${here} must be an object`); return undefined; }
    const out = {};
    const props = s.properties || {};
    for (const key of Object.keys(props)) {
      const v = validate(value[key], props[key], `${here}.${key}`, errors);
      if (v !== undefined) out[key] = v;
    }
    if (s.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!props[key]) errors.push(`${here}.${key} is not allowed`);
    } else {
      for (const key of Object.keys(value)) if (!props[key]) out[key] = value[key];
    }
    return out;
  }
  return value;
}

/**
 * @param {unknown} args
 * @param {object} schema
 * @returns {{ ok: boolean, value?: object, errors?: string[] }}
 */
function validateArgs(args, schema) {
  const errors = [];
  const input = (args === undefined || args === null) ? {} : args;
  if (typeOf(input) !== 'object') return { ok: false, errors: ['arguments must be an object'] };
  const value = validate(input, Object.assign({ type: 'object' }, schema || {}), '', errors);
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

module.exports = { validateArgs };
