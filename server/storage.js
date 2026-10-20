/* ==========================================================================
   server/storage.js — persistence interfaces + adapters

   Two interchangeable backends behind one small interface:
     memory   — process-local Map (tests, ephemeral dev)
     jsonfile — JSON files under AH_DATA_DIR (local-dev persistence)

   Repositories (conversations, messages, tasks, memory, settings, audit) are
   thin wrappers so a future Postgres/Supabase adapter can be dropped in
   without touching callers. All records are plain JSON objects.
   ========================================================================== */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const newId = (prefix) => `${prefix || 'id'}_${crypto.randomBytes(9).toString('hex')}`;

/* ----------------------------------------------------------- memory backend */

function createMemoryBackend() {
  /** @type {Map<string, Map<string, object>>} */
  const data = new Map();
  const coll = (name) => { if (!data.has(name)) data.set(name, new Map()); return data.get(name); };
  return {
    driver: 'memory',
    async put(name, id, rec) { coll(name).set(id, rec); },
    async get(name, id) { return coll(name).get(id) || null; },
    async all(name) { return Array.from(coll(name).values()); },
    async delete(name, id) { return coll(name).delete(id); },
    async clear(name) { coll(name).clear(); },
    async flush() {}
  };
}

/* --------------------------------------------------------- jsonfile backend */

function createJsonFileBackend(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  /** @type {Map<string, Map<string, object>>} */
  const cache = new Map();
  const loaded = new Set();
  let writeChain = Promise.resolve();

  const fileFor = (name) => path.join(dataDir, `${name.replace(/[^\w.-]/g, '_')}.json`);

  function load(name) {
    if (loaded.has(name)) return;
    loaded.add(name);
    const map = new Map();
    try {
      const raw = fs.readFileSync(fileFor(name), 'utf8');
      const obj = JSON.parse(raw);
      for (const k of Object.keys(obj)) map.set(k, obj[k]);
    } catch (e) { /* missing/corrupt file → start empty; a corrupt file is left for inspection */ }
    cache.set(name, map);
  }
  const coll = (name) => { load(name); return cache.get(name); };

  function persist(name) {
    const snapshot = JSON.stringify(Object.fromEntries(coll(name)), null, 2);
    writeChain = writeChain.then(async () => {
      const tmp = fileFor(name) + '.tmp';
      await fsp.writeFile(tmp, snapshot, 'utf8');
      await fsp.rename(tmp, fileFor(name));
    }).catch((e) => { /* keep the chain alive; surface via logger in caller if needed */ });
    return writeChain;
  }

  return {
    driver: 'jsonfile',
    async put(name, id, rec) { coll(name).set(id, rec); await persist(name); },
    async get(name, id) { return coll(name).get(id) || null; },
    async all(name) { return Array.from(coll(name).values()); },
    async delete(name, id) { const r = coll(name).delete(id); await persist(name); return r; },
    async clear(name) { coll(name).clear(); await persist(name); },
    async flush() { await writeChain; }
  };
}

/* ------------------------------------------------------------- repositories */

function createStorage(cfg) {
  const backend = cfg.storage.driver === 'jsonfile'
    ? createJsonFileBackend(cfg.storage.dataDir)
    : createMemoryBackend();

  const now = () => new Date().toISOString();

  const conversations = {
    async create({ title, owner, meta }) {
      const rec = { id: newId('conv'), title: title || 'New conversation', owner: owner || 'anon', meta: meta || {}, createdAt: now(), updatedAt: now() };
      await backend.put('conversations', rec.id, rec);
      return rec;
    },
    async get(id) { return backend.get('conversations', id); },
    async list(owner) {
      const all = await backend.all('conversations');
      return all.filter((c) => !owner || c.owner === owner).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },
    async touch(id, patch) {
      const rec = await backend.get('conversations', id);
      if (!rec) return null;
      Object.assign(rec, patch || {}, { updatedAt: now() });
      await backend.put('conversations', id, rec);
      return rec;
    }
  };

  const messages = {
    async add(conversationId, { role, content, meta }) {
      const rec = { id: newId('msg'), conversationId, role, content: String(content || ''), meta: meta || {}, createdAt: now() };
      await backend.put('messages', rec.id, rec);
      return rec;
    },
    async list(conversationId) {
      const all = await backend.all('messages');
      return all.filter((m) => m.conversationId === conversationId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    }
  };

  const tasks = {
    async save(task) { await backend.put('tasks', task.id, task); return task; },
    async get(id) { return backend.get('tasks', id); },
    async list() { return (await backend.all('tasks')).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); }
  };

  const memory = {
    async set(scope, key, value) {
      const id = `${scope}::${key}`;
      const rec = { id, scope, key, value, updatedAt: now() };
      await backend.put('memory', id, rec);
      return rec;
    },
    async get(scope, key) { return backend.get('memory', `${scope}::${key}`); },
    async list(scope) { return (await backend.all('memory')).filter((m) => m.scope === scope); },
    async remove(scope, key) { return backend.delete('memory', `${scope}::${key}`); }
  };

  const settings = {
    async set(key, value) { const rec = { id: key, key, value, updatedAt: now() }; await backend.put('settings', key, rec); return rec; },
    async get(key) { const r = await backend.get('settings', key); return r ? r.value : null; },
    async all() { return backend.all('settings'); }
  };

  const workflowRuns = {
    async save(run) { await backend.put('workflowRuns', run.id, run); return run; },
    async get(id) { return backend.get('workflowRuns', id); },
    async list() { return (await backend.all('workflowRuns')).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); },
    async delete(id) { return backend.delete('workflowRuns', id); }
  };

  const schedules = {
    async save(job) { await backend.put('schedules', job.id, job); return job; },
    async get(id) { return backend.get('schedules', id); },
    async list() { return (await backend.all('schedules')).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); },
    async delete(id) { return backend.delete('schedules', id); }
  };

  const audit = {
    async append(entry) {
      const rec = Object.assign({ id: newId('audit'), at: now() }, entry);
      await backend.put('audit', rec.id, rec);
      return rec;
    },
    async list(limit) {
      const all = (await backend.all('audit')).sort((a, b) => (a.at < b.at ? 1 : -1));
      return limit ? all.slice(0, limit) : all;
    }
  };

  return { driver: backend.driver, conversations, messages, tasks, workflowRuns, schedules, memory, settings, audit, flush: () => backend.flush() };
}

module.exports = { createStorage, newId };
