import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { test } from 'node:test';
import WebSocket from 'ws';
import { BrowserBridge } from '../server/src/bridge.js';
import { BridgeConnection, BridgeProxy } from '../server/src/proxy.js';

function waitOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function waitClose(socket) {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    socket.once('error', () => {});
  });
}

function until(predicate, timeout = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        const value = predicate();
        if (value) {
          resolve(value);
          return;
        }
      } catch {
        // Keep polling.
      }
      if (Date.now() - started > timeout) {
        reject(new Error('Timed out waiting for condition.'));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function mockExtension(port, id = 'mock-extension') {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message.type !== 'request') return;
    socket.send(JSON.stringify({
      type: 'response',
      id: message.id,
      ok: true,
      result: { echo: message.method, params: message.params }
    }));
  });
  return socket;
}

async function hello(socket, owner) {
  const ready = once(owner, 'ready');
  socket.send(JSON.stringify({ type: 'hello', version: 'test', extensionId: 'mock-extension' }));
  await ready;
}

test('proxy attaches to the owner and forwards requests', async () => {
  const port = await freePort();
  const owner = new BrowserBridge({ port, logger: () => {} });
  await owner.start();
  const proxy = new BridgeProxy({ port, logger: () => {} });
  let socket = null;

  try {
    await proxy.connect();
    assert.equal(proxy.status().mode, 'proxy');
    assert.equal(proxy.ready, false);

    const ready = once(proxy, 'ready');
    socket = mockExtension(port);
    await waitOpen(socket);
    await hello(socket, owner);
    await ready;

    assert.equal(proxy.ready, true);
    assert.equal(proxy.status().mode, 'proxy');
    assert.equal(owner.hello.extensionId, 'mock-extension');
    assert.equal(owner.status().controlClients, 1);

    const result = await proxy.request('echo', { value: 7 });
    assert.deepEqual(result, { echo: 'echo', params: { value: 7 } });

    const disconnected = once(proxy, 'disconnect');
    socket.close();
    await disconnected;
    assert.equal(proxy.ready, false);
  } finally {
    socket?.close();
    await proxy.close();
    await owner.close();
  }
});

test('attaching a proxy does not replace the extension', async () => {
  const port = await freePort();
  const owner = new BrowserBridge({ port, logger: () => {} });
  await owner.start();
  const socket = mockExtension(port);
  let proxy = null;

  try {
    await waitOpen(socket);
    await hello(socket, owner);

    proxy = new BridgeProxy({ port, logger: () => {} });
    await proxy.connect();

    assert.equal(owner.hello.extensionId, 'mock-extension');
    assert.equal(owner.connected, true);
    assert.equal(proxy.ready, true);

    const result = await owner.request('echo', { owner: true });
    assert.deepEqual(result, { echo: 'echo', params: { owner: true } });

    await proxy.close();
    proxy = null;
    assert.equal(owner.connected, true);

    const after = await owner.request('echo', { after: true });
    assert.deepEqual(after, { echo: 'echo', params: { after: true } });
  } finally {
    socket.close();
    await proxy?.close();
    await owner.close();
  }
});

test('proxy reports a token mismatch instead of taking over', async () => {
  const port = await freePort();
  const owner = new BrowserBridge({ port, token: 'correct-horse', logger: () => {} });
  await owner.start();
  const proxy = new BridgeProxy({ port, token: 'wrong', logger: () => {} });

  try {
    await assert.rejects(
      proxy.connect(),
      (error) => error.code === 'AUTH_FAILED' && /token/i.test(error.message)
    );
  } finally {
    await proxy.close();
    await owner.close();
  }
});

test('proxy refuses a port held by a process that is not a bridge', async () => {
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const proxy = new BridgeProxy({ port, connectTimeout: 300, logger: () => {} });

  try {
    await assert.rejects(
      proxy.connect(),
      (error) => error.code === 'PORT_IN_USE' && /did not answer/i.test(error.message)
    );
  } finally {
    await proxy.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a proxy takes over the port when the owner exits', async () => {
  const port = await freePort();
  const owner = new BrowserBridge({ port, logger: () => {} });
  await owner.start();

  const connection = new BridgeConnection({ port, logger: () => {} });
  let socket = null;

  try {
    await connection.start();
    assert.equal(connection.mode, 'proxy');

    socket = mockExtension(port);
    await waitOpen(socket);
    await hello(socket, owner);
    await until(() => connection.ready);
    assert.deepEqual(await connection.request('echo', { before: true }), {
      echo: 'echo',
      params: { before: true }
    });

    await owner.close();
    await until(() => connection.mode === 'owner');

    socket = mockExtension(port);
    await waitOpen(socket);
    const ready = once(connection, 'ready');
    socket.send(JSON.stringify({ type: 'hello', version: 'test', extensionId: 'mock-extension' }));
    await ready;

    assert.deepEqual(await connection.request('echo', { after: true }), {
      echo: 'echo',
      params: { after: true }
    });
  } finally {
    socket?.close();
    await connection.close();
  }
});
