'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { loadConfig } = require('../config');
const { createAgentHub } = require('../agent-hub');
const { createAgentProtocol } = require('../agent-protocol');
const { encodeLine, createLineDecoder } = require('../agent-framing');
const { AgentOfflineError, AgentBusyError, TimeoutError, ValidationError } = require('../errors');

const TOKEN = 'hub-token-value-for-tests-123456';
const SECRET = 'hub-session-secret-for-tests-0123456789';
const AGENT_ID = 'test-agent';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeHub(env) {
  const cfg = loadConfig(Object.assign({
    AH_ASSISTANT_ENV: 'test',
    AH_ENABLE_AGENT: '1',
    AH_AGENT_ID: AGENT_ID,
    AH_AGENT_HUB_TOKEN: TOKEN,
    AH_SESSION_SECRET: SECRET
  }, env || {}));
  cfg.agent.port = 0; // OS-assigned: never collide with a dev instance
  const audits = [];
  const hub = createAgentHub({
    cfg,
    logger: silent,
    audit: { record: (r) => { audits.push(r); return Promise.resolve(); } }
  });
  return { cfg, hub, audits };
}

/** Minimal scripted agent that speaks the real wire protocol. */
function client(port, opts = {}) {
  const secret = opts.secret === undefined ? SECRET : opts.secret;
  const agentId = opts.agentId === undefined ? AGENT_ID : opts.agentId;
  const proto = createAgentProtocol({ secret });
  const c = { proto, msgs: [], closed: false, sock: null };

  c.send = (type, payload, extra) => {
    const m = proto.encode(Object.assign({ type, agentId, payload: payload === undefined ? null : payload }, extra || {}));
    if (c.sock && !c.sock.destroyed) c.sock.write(encodeLine(m));
    return m;
  };
  c.wait = async (pred, ms = 3000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = c.msgs.find(pred);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error('timed out waiting for an agent message');
      await sleep(10);
    }
  };
  c.waitClosed = async (ms = 3000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (c.closed) return true;
      if (Date.now() > deadline) throw new Error('timed out waiting for the connection to close');
      await sleep(10);
    }
  };
  c.destroy = () => { c.closed = true; if (c.sock) c.sock.destroy(); };

  const decoder = createLineDecoder({
    onLine: (line) => {
      let m; try { m = JSON.parse(line); } catch (e) { return; }
      c.msgs.push(m);
      if (opts.autoRespond && m.type === 'task_invoke') {
        c.send('task_result', { taskId: m.payload.taskId, ok: true, result: { echoed: m.payload } });
      }
    },
    onError: () => { c.closed = true; }
  });

  c.sock = net.connect({ host: '127.0.0.1', port });
  c.sock.setNoDelay(true);
  c.sock.on('data', (chunk) => decoder(chunk));
  c.sock.on('close', () => { c.closed = true; });
  c.sock.on('error', () => { c.closed = true; });
  return c;
}

async function connect(c) {
  if (!c.sock.connecting) return;
  await new Promise((resolve, reject) => { c.sock.once('connect', resolve); c.sock.once('error', reject); });
}

function hello(c, opts = {}) {
  const payload = Object.assign({ agentId: AGENT_ID, token: TOKEN, client: 'hub-test', version: '1', platform: 'test', tools: ['files_list'] }, opts.payload || {});
  if (opts.token !== undefined) payload.token = opts.token;
  if (opts.agentId !== undefined) payload.agentId = opts.agentId;
  return c.send('hello', payload, { agentId: null });
}

async function startHub(env) {
  const h = makeHub(env);
  h.addr = await h.hub.start();
  h.port = h.addr.port;
  return h;
}

test('a valid handshake authenticates the agent and reports it online', async () => {
  const h = await startHub();
  const c = client(h.port);
  try {
    assert.equal(h.hub.status().online, false);
    await connect(c);
    hello(c);
    const ack = await c.wait((m) => m.type === 'hello_ack');
    // the client can verify the signature itself with the shared secret
    const verified = c.proto.decode(ack, { agentId: AGENT_ID });
    assert.equal(verified.type, 'hello_ack');
    assert.equal(verified.payload.heartbeatMs, h.cfg.agent.heartbeatMs);
    assert.equal(verified.payload.staleMs, h.cfg.agent.staleMs);

    const st = h.hub.status();
    assert.equal(st.online, true);
    assert.equal(st.count, 1);
    assert.equal(st.agents[0].agentId, AGENT_ID);
    assert.equal(st.agents[0].status, 'connected');
    assert.deepEqual(st.agents[0].client.tools, ['files_list'], 'client tool list is recorded');
    assert.equal(st.agents[0].client.platform, 'test');
    assert.ok(h.audits.some((a) => a.action === 'agent.auth' && a.outcome === 'allow' && a.actor === AGENT_ID));
    // no secret anywhere in the observable status
    assert.equal(JSON.stringify(st).includes(TOKEN), false);
    assert.equal(JSON.stringify(st).includes(SECRET), false);
  } finally { c.destroy(); await h.hub.stop(); }
});

test('a wrong or missing token is refused and the connection is dropped', async () => {
  for (const [label, opts] of [['wrong token', { token: 'not-the-right-token' }], ['missing token', { token: '' }], ['unknown agent id', { agentId: 'other-agent' }]]) {
    const h = await startHub();
    const c = client(h.port);
    try {
      await connect(c);
      hello(c, opts);
      const err = await c.wait((m) => m.type === 'error');
      assert.equal(err.payload.error, 'unauthorized', label);
      await c.waitClosed();
      assert.equal(h.hub.status().online, false, label);
      const deny = h.audits.find((a) => a.action === 'agent.auth' && a.outcome === 'deny');
      assert.ok(deny, `${label}: denial is audited`);
      assert.equal(JSON.stringify(h.audits).includes(TOKEN), false, `${label}: token never reaches the audit log`);
    } finally { c.destroy(); await h.hub.stop(); }
  }
});

test('heartbeats keep the agent fresh and are acknowledged', async () => {
  const h = await startHub();
  const c = client(h.port);
  try {
    await connect(c);
    hello(c);
    await c.wait((m) => m.type === 'hello_ack');
    const before = h.hub.status().agents[0].lastHeartbeat;
    await sleep(25);
    c.send('heartbeat');
    const ack = await c.wait((m) => m.type === 'heartbeat_ack');
    assert.equal(ack.payload.status, 'online');
    assert.ok(h.hub.status().agents[0].lastHeartbeat >= before, 'heartbeat advanced');
  } finally { c.destroy(); await h.hub.stop(); }
});

test('dispatch awaits the agent result and carries the tool arguments', async () => {
  const h = await startHub();
  const c = client(h.port, { autoRespond: true });
  try {
    await connect(c);
    hello(c);
    await c.wait((m) => m.type === 'hello_ack');
    const res = await h.hub.dispatch('files_list', { path: 'server', limit: 5 }, { actor: { type: 'admin', id: 't' } });
    assert.equal(res.ok, true);
    assert.equal(res.result.echoed.tool, 'files_list');
    assert.deepEqual(res.result.echoed.args, { path: 'server', limit: 5 });
    assert.equal(typeof res.taskId, 'string');
    assert.equal(h.hub.status().agents[0].pending, 0, 'correlation bookkeeping is cleaned up');
  } finally { c.destroy(); await h.hub.stop(); }
});

test('dispatch fails closed when no agent is connected, is busy, or the tool is not allowlisted', async () => {
  const h = await startHub({ AH_AGENT_TOOLS: 'files_list', AH_AGENT_MAX_CONCURRENT: '1' });
  const c = client(h.port); // no autoRespond: the agent never answers
  try {
    await assert.rejects(() => h.hub.dispatch('files_list', {}), AgentOfflineError);

    await connect(c);
    hello(c);
    await c.wait((m) => m.type === 'hello_ack');

    await assert.rejects(() => h.hub.dispatch('project_inspect', {}), ValidationError, 'not on the tool allowlist');
    const p1 = h.hub.dispatch('files_list', {});
    await sleep(30);
    await assert.rejects(() => h.hub.dispatch('files_list', {}), AgentBusyError, 'maxConcurrent = 1');

    const invoke = await c.wait((m) => m.type === 'task_invoke');
    assert.equal(h.hub.cancel(invoke.payload.taskId, 'operator'), true, 'cancel targets the live task');
    assert.equal(h.hub.cancel('no-such-task'), false, 'unknown task ids are a no-op');

    // dropping the agent must not leave a pending task hanging forever
    c.destroy();
    await assert.rejects(() => p1, AgentOfflineError, 'in-flight work is rejected on disconnect');
  } finally { c.destroy(); await h.hub.stop(); }
});

test('a task that the agent never answers times out and is cancelled', async () => {
  const h = await startHub();
  const c = client(h.port); // silent agent
  try {
    await connect(c);
    hello(c);
    await c.wait((m) => m.type === 'hello_ack');
    const started = Date.now();
    await assert.rejects(() => h.hub.dispatch('files_list', {}, { timeoutMs: 400 }), TimeoutError);
    assert.ok(Date.now() - started >= 380, 'it actually waited for the timeout');
    const cancel = await c.wait((m) => m.type === 'task_cancel');
    assert.equal(cancel.payload.reason, 'timeout');
    assert.equal(h.hub.status().agents[0].pending, 0, 'the pending entry is released');
  } finally { c.destroy(); await h.hub.stop(); }
});

test('replayed and mis-identified messages are rejected', async () => {
  const h = await startHub();
  const c = client(h.port);
  try {
    await connect(c);
    hello(c);
    await c.wait((m) => m.type === 'hello_ack');

    // an identical, already-accepted message is not delivered twice
    const hb = c.send('heartbeat');
    await c.wait((m) => m.type === 'heartbeat_ack');
    c.sock.write(encodeLine(hb));
    const err = await c.wait((m) => m.type === 'error' && m.payload.error === 'invalid_message');
    assert.ok(err.payload.message.toLowerCase().includes('replay'));

    // a message bound to a different identity kills the connection
    c.send('heartbeat', {}, { agentId: 'another-agent' });
    await c.waitClosed();
    assert.equal(h.hub.status().online, false, 'identity mismatch drops the session');
  } finally { c.destroy(); await h.hub.stop(); }
});

test('a silent agent goes stale and is dropped from the status', async () => {
  const h = await startHub({ AH_AGENT_STALE_MS: '2000' });
  const c = client(h.port); // connects and then never heartbeats
  try {
    await connect(c);
    hello(c);
    await c.wait((m) => m.type === 'hello_ack');
    assert.equal(h.hub.status().online, true);
    // the socket has an idle timeout of staleMs, and the sweeper is a backstop
    await c.waitClosed(5000);
    assert.equal(h.hub.status().online, false, 'stale connection removed');
    assert.ok(h.audits.some((a) => a.action === 'agent.disconnect' || a.action === 'agent.stale'));
  } finally { c.destroy(); await h.hub.stop(); }
});

test('a newer connection for the same agent replaces the older one', async () => {
  const h = await startHub();
  const c1 = client(h.port);
  const c2 = client(h.port);
  try {
    await connect(c1);
    hello(c1);
    await c1.wait((m) => m.type === 'hello_ack');
    assert.equal(h.hub.status().count, 1);

    await connect(c2);
    hello(c2);
    await c2.wait((m) => m.type === 'hello_ack');
    await c1.waitClosed();
    assert.equal(h.hub.status().count, 1, 'exactly one live connection');
    assert.equal(h.hub.status().agents[0].agentId, AGENT_ID);
  } finally { c1.destroy(); c2.destroy(); await h.hub.stop(); }
});

test('stop() closes every connection and rejects in-flight work', async () => {
  const h = await startHub();
  const c = client(h.port);
  try {
    await connect(c);
    hello(c);
    await c.wait((m) => m.type === 'hello_ack');
    const p = h.hub.dispatch('files_list', {});
    await sleep(20);
    await h.hub.stop();
    await assert.rejects(() => p, AgentOfflineError);
    await c.waitClosed();
    assert.equal(h.hub.status().online, false);
    await h.hub.stop(); // idempotent
  } finally { c.destroy(); }
});
