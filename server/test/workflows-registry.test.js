'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../workflows/registry');
const { registerBuiltins } = require('../workflows/workflows');

const { register, get, list, applyInputs, resolveSteps, availability, assertAvailable, _clear } = registry;

const ALL_TOOLS = ['service_health', 'agent_status', 'qa_run', 'project_read_file', 'content_check', 'content_generate', 'draft_write'];
const HAVE_TOOLS = { get: (n) => (ALL_TOOLS.includes(n) ? { name: n, enabled: true } : null) };
const NO_TOOLS = { get: () => null };
const MODEL = { hasModel: () => true };
const NO_MODEL = { hasModel: () => false };

before(() => { _clear(); registerBuiltins(); });
after(() => { _clear(); registerBuiltins(); });

test('builtins register with stable versions and truthful support flags', () => {
  const lst = list();
  const byId = Object.fromEntries(lst.map((w) => [w.id, w]));
  assert.equal(byId['website-qa'].version, '1.0.0');
  assert.equal(byId['website-qa'].permissionClass, 'read');
  assert.equal(byId['website-health-audit'].permissionClass, 'read');
  assert.equal(byId['blog-draft-production'].permissionClass, 'write');
  assert.equal(byId['blog-draft-production'].requiresApproval, true);
  assert.equal(byId['approved-file-change'].supported, false);
  assert.ok(byId['approved-file-change'].unsupportedReason.includes('patch'));
  assert.equal(get('website-qa@1.0.0').id, 'website-qa');
  assert.equal(get('nope'), null);
});

test('applyInputs rejects unknown, wrong-typed and out-of-range inputs', () => {
  const qa = get('website-qa');
  assert.throws(() => applyInputs(qa.inputs, { surprise: 1 }), /Unknown input/);
  assert.throws(() => applyInputs(qa.inputs, { suites: 'not-an-array' }), /must be an array/);
  assert.throws(() => applyInputs(qa.inputs, { suites: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }), /at most 6/);
  assert.deepEqual(applyInputs(qa.inputs, undefined), {});

  const blog = get('blog-draft-production');
  assert.throws(() => applyInputs(blog.inputs, {}), /Input "topic" is required/);
  assert.throws(() => applyInputs(blog.inputs, { topic: 'x', words: 50 }), /must be >= 200/);
  assert.throws(() => applyInputs(blog.inputs, { topic: 'x', words: 12.5 }), /integer/);
  const withDefaults = applyInputs(blog.inputs, { topic: 'hello' });
  assert.equal(withDefaults.words, 800);
  assert.equal(withDefaults.constraints, '');
  assert.equal(withDefaults.slug, 'article');
});

test('register rejects invalid definitions (default-deny on definition quality)', () => {
  const base = { version: '1.0.0', tools: ['t_a'], steps: [{ id: 'one', tool: 't_a', argsTemplate: {} }] };
  assert.throws(() => register(Object.assign({}, base, { id: 'Bad_Id' })), /bad workflow id/);
  assert.throws(() => register(Object.assign({}, base, { id: 'ok-id', version: 'v1' })), /version must be semver/);
  assert.throws(() => register(Object.assign({}, base, { id: 'ok-id', permissionClass: 'telepathy' })), /unknown permissionClass/);
  assert.throws(() => register(Object.assign({}, base, {
    id: 'ok-id',
    steps: [{ id: 'two', tool: 't_a', argsTemplate: {}, dependsOn: ['never'] }]
  })), /not an earlier step/);
  assert.throws(() => register(Object.assign({}, base, {
    id: 'ok-id',
    steps: [{ id: 'one', tool: 't_a' }, { id: 'one', tool: 't_a' }]
  })), /duplicate step id/);
  assert.throws(() => register(Object.assign({}, base, {
    id: 'ok-id',
    steps: [{ id: 'one', tool: 'shell_exec' }]
  })), /outside the workflow's permitted tools/);
  assert.throws(() => register(Object.assign({}, base, {
    id: 'ok-id',
    inputs: { type: 'object', properties: { nested: { type: 'object', properties: {} } } } // missing additionalProperties:false
  })), /additionalProperties/);
  assert.throws(() => register(Object.assign({}, base, {
    id: 'ok-id',
    successCriteria: [{ step: 'one', expect: { deep: { a: 1 } } }]
  })), /scalars/);
  const steps21 = Array.from({ length: 21 }, (_, i) => ({ id: `s-${i}`, tool: 't_a' }));
  assert.throws(() => register(Object.assign({}, base, { id: 'ok-id', steps: steps21 })), /too many steps/);
});

test('website-qa expands into ordered, allowlisted steps from validated inputs', () => {
  const wf = get('website-qa');
  const cfg = { agent: { enabled: true, qaSuites: ['qa-pages', 'qa-device', 'qa-scroll'] } };

  const all = resolveSteps(wf, {}, cfg);
  assert.deepEqual(all.map((s) => s.id), ['check-server', 'check-agent', 'run-qa-qa-pages', 'run-qa-qa-device', 'run-qa-qa-scroll']);
  assert.ok(all.every((s) => ['service_health', 'agent_status', 'qa_run'].includes(s.tool)));

  const subset = resolveSteps(wf, { suites: ['qa-device'] }, cfg);
  assert.deepEqual(subset.map((s) => s.id), ['check-server', 'check-agent', 'run-qa-qa-device']);

  assert.throws(() => resolveSteps(wf, { suites: ['qa-evil'] }, cfg), /not authorized/);
  assert.throws(() => resolveSteps(wf, { suites: ['bad suite!'] }, cfg), /Invalid QA suite id/);
});

test('expand output is validated against the workflow tool allowlist', () => {
  register({
    id: 'expand-tamper',
    version: '1.0.0',
    tools: ['t_a'],
    expand: () => [{ id: 'evil', tool: 'draft_write', argsTemplate: {} }]
  });
  assert.throws(() => resolveSteps(get('expand-tamper'), {}, {}), /outside the workflow's permitted tools/);
});

test('availability is honest about missing capabilities and unsupported builds', () => {
  const qa = get('website-qa');
  assert.deepEqual(availability(qa, { providers: NO_MODEL, tools: NO_TOOLS }), { ok: true, reason: null });

  const blog = get('blog-draft-production');
  assert.equal(availability(blog, { providers: NO_MODEL, tools: HAVE_TOOLS }).ok, false);
  assert.match(availability(blog, { providers: NO_MODEL, tools: HAVE_TOOLS }).reason, /no model provider/);
  assert.equal(availability(blog, { providers: MODEL, tools: HAVE_TOOLS }).ok, true);
  assert.equal(availability(blog, { providers: MODEL, tools: { get: () => null } }).ok, false);

  const fileChange = get('approved-file-change');
  assert.equal(availability(fileChange, { providers: MODEL, tools: HAVE_TOOLS }).ok, false);
  assert.throws(() => assertAvailable(fileChange, { providers: MODEL, tools: HAVE_TOOLS }), (e) => e.code === 'workflow_unsupported' && e.status === 501);
});

test('versioned lookups keep old versions addressable while bare id tracks latest', () => {
  register({
    id: 'versioned-demo', version: '1.0.0', tools: ['t_a'],
    steps: [{ id: 'one', tool: 't_a', argsTemplate: {} }]
  });
  register({
    id: 'versioned-demo', version: '2.0.0', tools: ['t_a'],
    steps: [{ id: 'one', tool: 't_a', argsTemplate: {} }, { id: 'two', tool: 't_a', argsTemplate: {}, dependsOn: ['one'] }]
  });
  assert.equal(get('versioned-demo').version, '2.0.0');
  assert.equal(get('versioned-demo@1.0.0').version, '1.0.0');
  assert.equal(get('versioned-demo@2.0.0').version, '2.0.0');
  const entry = list().find((w) => w.id === 'versioned-demo');
  assert.equal(entry.version, '2.0.0');
});
