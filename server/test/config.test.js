'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, safeSummary } = require('../config');
const { ConfigError } = require('../errors');

const base = { AH_ASSISTANT_ENV: 'test' };

test('defaults are safe and development-friendly', () => {
  const cfg = loadConfig(base);
  assert.equal(cfg.env, 'test');
  assert.equal(cfg.provider.name, 'none');
  assert.equal(cfg.storage.driver, 'memory');
  assert.equal(cfg.http.port, 8787);
  assert.equal(cfg.http.host, '127.0.0.1');
  assert.equal(cfg.features.tools, true);
  assert.equal(cfg.features.voice, false);
});

test('jsonfile storage is the default outside tests', () => {
  assert.equal(loadConfig({ AH_ASSISTANT_ENV: 'development' }).storage.driver, 'jsonfile');
});

test('invalid enum is rejected', () => {
  assert.throws(() => loadConfig({ ...base, AH_PROVIDER: 'banana' }), ConfigError);
  assert.throws(() => loadConfig({ ...base, AH_ROUTING: 'sideways' }), ConfigError);
  assert.throws(() => loadConfig({ ...base, AH_STORAGE_DRIVER: 'sqlite' }), ConfigError);
});

test('invalid port is rejected', () => {
  assert.throws(() => loadConfig({ ...base, AH_ASSISTANT_PORT: '99999' }), ConfigError);
  assert.throws(() => loadConfig({ ...base, AH_ASSISTANT_PORT: 'abc' }), ConfigError);
});

test('a cloud provider requires an API key', () => {
  assert.throws(() => loadConfig({ ...base, AH_PROVIDER: 'openai', AH_MODEL: 'gpt-x' }), ConfigError);
  const cfg = loadConfig({ ...base, AH_PROVIDER: 'openai', AH_MODEL: 'gpt-x', AH_API_KEY: 'sk-test' });
  assert.equal(cfg.provider.name, 'openai');
  assert.equal(cfg.meta.cloudKeyRequired, true);
});

test('a local provider does not require a key', () => {
  const cfg = loadConfig({ ...base, AH_PROVIDER: 'local', AH_LOCAL_MODEL: 'llama3.1' });
  assert.equal(cfg.provider.name, 'local');
  assert.equal(cfg.meta.localPrimary, true);
});

test('openai-compatible pointed at localhost is treated as local', () => {
  const cfg = loadConfig({ ...base, AH_PROVIDER: 'openai-compatible', AH_BASE_URL: 'http://127.0.0.1:11434/v1' });
  assert.equal(cfg.meta.localPrimary, true);
  assert.equal(cfg.meta.cloudKeyRequired, false);
});

test('production requires explicit origins and a session secret, and forbids a dev admin token', () => {
  assert.throws(() => loadConfig({ AH_ASSISTANT_ENV: 'production', AH_API_KEY: 'x' }), ConfigError);
  assert.throws(() => loadConfig({
    AH_ASSISTANT_ENV: 'production', AH_SESSION_SECRET: 'a'.repeat(32),
    AH_ASSISTANT_ALLOWED_ORIGINS: 'https://ahsolution.live', AH_ADMIN_TOKEN: 'dev'
  }), ConfigError);
  const cfg = loadConfig({
    AH_ASSISTANT_ENV: 'production', AH_SESSION_SECRET: 'a'.repeat(32),
    AH_ASSISTANT_ALLOWED_ORIGINS: 'https://ahsolution.live'
  });
  assert.equal(cfg.isProd, true);
  assert.deepEqual(cfg.http.allowedOrigins, ['https://ahsolution.live']);
});

test('safeSummary never leaks secrets', () => {
  const cfg = loadConfig({ ...base, AH_PROVIDER: 'openai', AH_MODEL: 'm', AH_API_KEY: 'sk-super-secret', AH_SESSION_SECRET: 'ssshhh' });
  const summary = safeSummary(cfg);
  const text = JSON.stringify(summary);
  assert.ok(!text.includes('sk-super-secret'));
  assert.ok(!text.includes('ssshhh'));
  assert.equal(summary.provider.cloudKeyPresent, true);
});
