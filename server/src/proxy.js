/*
 * Shares one BrowserBridge across DSH sessions.
 *
 * The first MCP server to start owns ws://127.0.0.1:8787. Every later server
 * attaches to that owner over a local control channel instead of failing with
 * PORT_IN_USE. Control requests are forwarded by the owner and answered by the
 * single Chrome extension connection, so all sessions see the same browser.
 *
 * If the owner exits, one of the attached sessions takes over the listening
 * port and the extension reconnects to it. The others attach to the new owner.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { BrowserBridge, BridgeError } from './bridge.js';

const SERVER_NAME = 'dsh-browser-bridge';

function stderrLogger(message) {
  process.stderr.write(`[browser-bridge] ${message}\n`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampTimeout(value, fallback) {
  return Math.max(1000, Math.min(Number(value) || fallback, 180000));
}

/**
 * MCP-side proxy attached to the session that owns the listening port.
 */
export class BridgeProxy extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host || '127.0.0.1';
    this.port = Number(options.port) || 8787;
    this.token = options.token || '';
    this.logger = options.logger || stderrLogger;
    this.requestTimeout = Number(options.requestTimeout) || 30000;
    this.connectTimeout = Number(options.connectTimeout) || 3000;
    this.socket = null;
    this.remoteStatus = null;
    this.pending = new Map();
    this.attached = false;
    this.closed = false;
  }

  get mode() {
    return 'proxy';
  }

  get connected() {
    return this.attached && this.remoteStatus?.connected === true;
  }

  get ready() {
    return this.attached && this.remoteStatus?.ready === true;
  }

  get hello() {
    return this.remoteStatus?.extension || null;
  }

  async connect() {
    if (this.attached) return this;
    if (this.closed) throw new BridgeError('The bridge proxy is closed.', 'CLOSED');

    const params = new URLSearchParams({ role: 'control' });
    if (this.token) params.set('token', this.token);
    const socket = new WebSocket(`ws://${this.host}:${this.port}/?${params.toString()}`, {
      handshakeTimeout: this.connectTimeout,
      perMessageDeflate: false
    });
    this.socket = socket;

    try {
      const welcome = await this.waitForWelcome(socket);
      this.remoteStatus = { ...(welcome.status || {}) };
      this.attached = true;
      this.bind(socket);
      this.logger(`attached to the bridge owner at ws://${this.host}:${this.port}`);
      if (this.ready) this.emit('ready', this.hello);
      return this;
    } catch (error) {
      this.socket = null;
      socket.on('error', () => {});
      try {
        if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
        else socket.close();
      } catch {
        // Ignore.
      }
      throw error;
    }
  }

  waitForWelcome(socket) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.off('message', onMessage);
        socket.off('error', onError);
        socket.off('close', onClose);
        if (error) reject(error);
        else resolve(value);
      };

      const timer = setTimeout(() => {
        finish(new BridgeError(
          `Port ${this.port} is in use, but the process did not answer as an DSH Browser Bridge. Stop it or set DSH_BROWSER_PORT to a free port.`,
          'PORT_IN_USE'
        ));
      }, this.connectTimeout);

      const onMessage = (raw) => {
        let message;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (message?.type === 'control_welcome' && message.server === SERVER_NAME) {
          finish(null, message);
        }
      };

      const onError = (error) => {
        finish(new BridgeError(
          `Could not attach to the bridge at ws://${this.host}:${this.port}: ${error.message}`,
          'PORT_IN_USE'
        ));
      };

      const onClose = (code, reason) => {
        if (code === 4001) {
          finish(new BridgeError(
            'The bridge owner rejected the connection token. Use the same DSH_BROWSER_TOKEN in every DSH session and in the extension popup.',
            'AUTH_FAILED'
          ));
          return;
        }
        const detail = reason?.toString() ? `: ${reason.toString()}` : '';
        finish(new BridgeError(
          `The bridge owner closed the control connection (code ${code}${detail}).`,
          'PORT_IN_USE'
        ));
      };

      socket.on('message', onMessage);
      socket.on('error', onError);
      socket.on('close', onClose);
    });
  }

  bind(socket) {
    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.handleMessage(message);
    });

    socket.on('close', (code, reason) => {
      const wasAttached = this.attached;
      this.attached = false;
      if (this.socket === socket) this.socket = null;
      this.rejectPending('The bridge owner disconnected.', 'DISCONNECTED');
      if (wasAttached) {
        const detail = reason?.toString() || '';
        this.emit('disconnect', { code, reason: detail, owner: true });
        this.emit('close', { code, reason: detail, owner: true });
      }
    });

    socket.on('error', (error) => {
      this.logger(`control socket error: ${error.message}`);
    });
  }

  handleMessage(message) {
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'control_event') {
      if (message.event === 'ready') {
        this.remoteStatus = {
          ...(this.remoteStatus || {}),
          connected: true,
          ready: true,
          extension: message.data || null,
          connectedAt: message.data?.at || Date.now(),
          lastSeen: Date.now()
        };
        this.emit('ready', message.data);
      } else if (message.event === 'disconnect') {
        this.remoteStatus = {
          ...(this.remoteStatus || {}),
          connected: false,
          ready: false,
          extension: null,
          connectedAt: null,
          lastSeen: Date.now()
        };
        this.emit('disconnect', message.data || {});
      } else if (message.event === 'event') {
        this.remoteStatus = { ...(this.remoteStatus || {}), lastSeen: Date.now() };
        this.emit('event', message.data);
      }
      return;
    }

    if (message.type === 'control_response') {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok) {
        entry.resolve(message.result);
        return;
      }
      const error = message.error || {};
      entry.reject(new BridgeError(
        error.message || 'The bridge owner reported an unknown error.',
        error.code || 'CONTROL_ERROR',
        error.details
      ));
      return;
    }

    if (message.type === 'control_pong') return;
  }

  async request(method, params = {}, options = {}) {
    if (!this.attached || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new BridgeError(
        'The DSH session that owns the browser bridge is not reachable. Reconnect it or restart DSH.',
        'NOT_CONNECTED'
      );
    }

    const timeout = clampTimeout(options.timeout, this.requestTimeout);
    const id = options.id || randomUUID();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError(
          `The browser did not respond to "${method}" within ${Math.round(timeout / 1000)}s through the bridge owner. The page may be blocked by a native dialog or a navigation.`,
          'TIMEOUT',
          { method, timeout }
        ));
      }, timeout + 2000);

      this.pending.set(id, { resolve, reject, timer, method });

      try {
        this.socket.send(JSON.stringify({
          type: 'control_request',
          id,
          method,
          params,
          timeout
        }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new BridgeError('Could not send the request to the bridge owner.', 'SEND_FAILED', {
          cause: error.message
        }));
      }
    });
  }

  status() {
    const remote = this.remoteStatus || {};
    return {
      ...remote,
      connected: this.connected,
      ready: this.ready,
      host: this.host,
      port: this.port,
      extension: remote.extension || null,
      connectedAt: remote.connectedAt || null,
      lastSeen: remote.lastSeen || 0,
      pendingRequests: this.pending.size,
      tokenRequired: !!this.token,
      mode: 'proxy',
      controlClients: 0
    };
  }

  rejectPending(message, code) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new BridgeError(message, code, { method: entry.method }));
      this.pending.delete(id);
    }
  }

  async close() {
    this.closed = true;
    this.rejectPending('The browser bridge proxy is shutting down.', 'SHUTDOWN');
    const socket = this.socket;
    this.socket = null;
    this.attached = false;
    if (!socket) return;
    try {
      socket.close(1001, 'proxy shutdown');
    } catch {
      // Ignore.
    }
    await new Promise((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        try {
          socket.terminate();
        } catch {
          // Ignore.
        }
        resolve();
      }, 500);
      socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

/**
 * Stable facade used by index.js. It owns the port when possible, otherwise it
 * proxies to the owner, and it switches roles if the owner exits.
 */
export class BridgeConnection extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.logger = options.logger || stderrLogger;
    this.backend = null;
    this.mode = null;
    this.closed = false;
    this.timer = null;
    this.takingOver = false;
    this.retryDelay = 100;
    this.binding = null;
  }

  get connected() {
    return !!this.backend?.connected;
  }

  get ready() {
    return !!this.backend?.ready;
  }

  get hello() {
    return this.backend?.hello || null;
  }

  status() {
    if (this.backend) return this.backend.status();
    return {
      connected: false,
      ready: false,
      host: this.options.host || '127.0.0.1',
      port: Number(this.options.port) || 8787,
      extension: null,
      connectedAt: null,
      lastSeen: 0,
      pendingRequests: 0,
      tokenRequired: !!this.options.token,
      mode: null,
      controlClients: 0
    };
  }

  request(method, params = {}, options = {}) {
    if (!this.backend) {
      return Promise.reject(new BridgeError(
        'No browser bridge is available. Start DSH again or reconnect the chrome MCP server.',
        'NOT_CONNECTED'
      ));
    }
    return this.backend.request(method, params, options);
  }

  async start() {
    const owner = new BrowserBridge({ ...this.options, logger: () => {} });
    try {
      await owner.start();
      owner.logger = this.logger;
      this.install(owner, 'owner');
      this.logger('owning the browser bridge');
      return this;
    } catch (error) {
      await owner.close().catch(() => {});
      if (error.code !== 'PORT_IN_USE') throw error;
    }

    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const proxy = new BridgeProxy({ ...this.options, logger: () => {} });
      try {
        await proxy.connect();
        proxy.logger = this.logger;
        this.install(proxy, 'proxy');
        this.logger(`attached to the bridge owner at ws://${this.options.host || '127.0.0.1'}:${this.options.port || 8787} (proxy mode)`);
        return this;
      } catch (error) {
        lastError = error;
        await proxy.close().catch(() => {});
        if (error.code === 'AUTH_FAILED' || error.code === 'CLOSED') throw error;
        // A port held by a non-bridge process answers the TCP connection but
        // never sends a welcome. Retrying only helps when the owner is still
        // starting, so fail fast on the timeout instead of waiting five times.
        if (/did not answer as an DSH Browser Bridge/i.test(error.message)) throw error;
        await delay(100 * (attempt + 1));
      }
    }

    throw lastError || new BridgeError(
      `Port ${this.options.port || 8787} is in use and no bridge owner could be reached.`,
      'PORT_IN_USE'
    );
  }

  install(backend, mode) {
    this.detach();
    this.backend = backend;
    this.mode = mode;

    const handlers = {
      ready: (data) => this.emit('ready', data),
      disconnect: (data) => this.emit('disconnect', data),
      event: (data) => this.emit('event', data),
      close: (data) => {
        if (mode === 'proxy') this.handleProxyClose(data);
      }
    };

    for (const [name, handler] of Object.entries(handlers)) backend.on(name, handler);
    this.binding = { backend, handlers };

    if (backend.ready) {
      const hello = backend.hello;
      if (hello) this.emit('ready', hello);
    }
  }

  detach() {
    if (!this.binding) return;
    const { backend, handlers } = this.binding;
    for (const [name, handler] of Object.entries(handlers)) backend.off(name, handler);
    this.binding = null;
  }

  handleProxyClose(data) {
    if (this.closed) return;
    this.detach();
    this.backend = null;
    this.mode = null;
    this.emit('detached', data);
    this.scheduleTakeover();
  }

  scheduleTakeover() {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.takeover();
    }, this.retryDelay);
  }

  async takeover() {
    if (this.closed || this.takingOver) return;
    this.takingOver = true;
    try {
      const owner = new BrowserBridge({ ...this.options, logger: () => {} });
      try {
        await owner.start();
        owner.logger = this.logger;
        this.install(owner, 'owner');
        this.retryDelay = 100;
        this.logger('took over the browser bridge after the previous owner exited');
        this.emit('takeover', { mode: 'owner' });
        return;
      } catch (error) {
        await owner.close().catch(() => {});
        if (error.code !== 'PORT_IN_USE') throw error;
      }

      const proxy = new BridgeProxy({ ...this.options, logger: () => {} });
      try {
        await proxy.connect();
        proxy.logger = this.logger;
        this.install(proxy, 'proxy');
        this.retryDelay = 100;
        this.logger('attached to the new bridge owner');
        this.emit('takeover', { mode: 'proxy' });
        return;
      } catch (error) {
        await proxy.close().catch(() => {});
        if (error.code === 'AUTH_FAILED') {
          this.logger('the new bridge owner rejected the token; waiting for a matching owner');
        }
        this.retryDelay = Math.min(this.retryDelay * 2, 2000);
        this.scheduleTakeover();
      }
    } catch (error) {
      this.logger(`bridge takeover failed: ${error.message}`);
      this.retryDelay = Math.min(this.retryDelay * 2, 2000);
      this.scheduleTakeover();
    } finally {
      this.takingOver = false;
    }
  }

  async close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.detach();
    const backend = this.backend;
    this.backend = null;
    this.mode = null;
    if (backend) await backend.close();
  }
}
