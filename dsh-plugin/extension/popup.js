/*
 * Popup controller for the DSH Browser Bridge extension.
 * All UI text is English; the MCP tool descriptions live on the server.
 */

const $ = (id) => document.getElementById(id);

const elements = {
  statusPill: $('statusPill'),
  currentServer: $('currentServer'),
  extensionVersion: $('extensionVersion'),
  activeTab: $('activeTab'),
  lastSeen: $('lastSeen'),
  feedback: $('feedback'),
  tabCount: $('tabCount'),
  debuggerTabs: $('debuggerTabs'),
  hasToken: $('hasToken'),
  lastError: $('lastError'),
  connectBtn: $('connectBtn'),
  disconnectBtn: $('disconnectBtn'),
  saveBtn: $('saveBtn'),
  refreshBtn: $('refreshBtn'),
  detachBtn: $('detachBtn'),
  extensionsBtn: $('extensionsBtn'),
  connectionForm: $('connectionForm'),
  serverUrl: $('serverUrl'),
  token: $('token'),
  autoConnect: $('autoConnect'),
  preferCdp: $('preferCdp'),
  keepAttached: $('keepAttached'),
  interceptDialogs: $('interceptDialogs'),
  confirmDialogs: $('confirmDialogs'),
  promptDialogText: $('promptDialogText'),
  autoSwitchNewTabs: $('autoSwitchNewTabs')
};

const settingInputs = [
  elements.serverUrl,
  elements.token,
  elements.autoConnect,
  elements.preferCdp,
  elements.keepAttached,
  elements.interceptDialogs,
  elements.confirmDialogs,
  elements.promptDialogText,
  elements.autoSwitchNewTabs
];

let currentStatus = null;
let formDirty = false;
let feedbackTimer = null;
let pollTimer = null;
let busy = false;

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The extension did not respond in 15s.')), 15000);
    try {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        clearTimeout(timer);
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        if (!response) {
          reject(new Error('The service worker did not return a response.'));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

function readStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get('settings', (result) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(result && result.settings ? result.settings : null);
    });
  });
}

function setFeedback(text, kind = '') {
  clearTimeout(feedbackTimer);
  elements.feedback.textContent = text || '';
  elements.feedback.className = 'feedback' + (kind ? ' ' + kind : '');
  if (text) {
    feedbackTimer = setTimeout(() => {
      elements.feedback.textContent = '';
      elements.feedback.className = 'feedback';
    }, 6000);
  }
}

function setBusy(value) {
  busy = value;
  for (const button of [elements.connectBtn, elements.disconnectBtn, elements.saveBtn, elements.refreshBtn, elements.detachBtn]) {
    if (value) button.disabled = true;
  }
  if (!value) updateButtons();
}

function updateButtons() {
  const state = currentStatus ? currentStatus.wsState : 'disconnected';
  elements.connectBtn.disabled = busy || state === 'connected' || state === 'connecting';
  elements.disconnectBtn.disabled = busy || state === 'disconnected';
  elements.saveBtn.disabled = busy;
  elements.refreshBtn.disabled = busy;
  elements.detachBtn.disabled = busy;
}

function formatTime(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleTimeString('en-US');
  } catch {
    return '—';
  }
}

function shorten(value, max) {
  const text = String(value || '');
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function renderStatus(status) {
  if (!status) return;
  currentStatus = status;
  const state = status.wsState || (status.connected ? 'connected' : 'disconnected');

  elements.statusPill.className = 'pill ' + (
    state === 'connected' ? 'pill-on' : state === 'connecting' ? 'pill-connecting' : 'pill-off'
  );
  elements.statusPill.textContent = state === 'connected'
    ? 'Connected'
    : state === 'connecting'
      ? 'Connecting…'
      : 'Disconnected';

  elements.currentServer.textContent = status.serverUrl || '—';
  elements.currentServer.title = status.serverUrl || '';
  elements.extensionVersion.textContent = status.extensionVersion ? `v${status.extensionVersion}` : '—';

  const tabs = Array.isArray(status.tabs) ? status.tabs : [];
  const active = tabs.find((tab) => tab.active) || tabs.find((tab) => tab.id === status.activeTabId);
  if (active) {
    const label = active.title || active.url || `Tab ${active.id}`;
    elements.activeTab.textContent = shorten(label, 42);
    elements.activeTab.title = `${label}\n${active.url || ''}`;
  } else {
    elements.activeTab.textContent = status.activeTabId ? `Tab ${status.activeTabId}` : 'None';
    elements.activeTab.title = '';
  }

  elements.lastSeen.textContent = formatTime(status.lastServerSeen);
  elements.tabCount.textContent = String(tabs.length);
  elements.debuggerTabs.textContent = Array.isArray(status.debuggerTabs) && status.debuggerTabs.length
    ? status.debuggerTabs.map((item) => item.tabId).join(', ')
    : 'None';
  elements.hasToken.textContent = status.hasToken ? 'Yes' : 'No';

  if (status.lastError) {
    elements.lastError.textContent = status.lastError;
    elements.lastError.hidden = false;
  } else {
    elements.lastError.textContent = '';
    elements.lastError.hidden = true;
  }

  updateButtons();
}

async function refreshStatus(showErrors = false) {
  try {
    const response = await send('getStatus');
    if (!response.ok) throw new Error(response.error || 'Failed to query status.');
    renderStatus(response.status);
  } catch (error) {
    if (showErrors) setFeedback(error.message, 'bad');
  }
}

function fillForm(settings) {
  if (!settings) return;
  elements.serverUrl.value = settings.serverUrl || 'ws://127.0.0.1:8787';
  elements.token.value = settings.token || '';
  elements.autoConnect.checked = settings.autoConnect !== false;
  elements.preferCdp.checked = settings.preferCdp !== false;
  elements.keepAttached.checked = settings.keepAttached !== false;
  elements.interceptDialogs.checked = settings.interceptDialogs !== false;
  elements.confirmDialogs.checked = settings.confirmDialogs !== false;
  elements.promptDialogText.value = settings.promptDialogText || '';
  elements.autoSwitchNewTabs.checked = !!settings.autoSwitchNewTabs;
  formDirty = false;
}

function readForm() {
  return {
    serverUrl: elements.serverUrl.value.trim() || 'ws://127.0.0.1:8787',
    token: elements.token.value.trim(),
    autoConnect: elements.autoConnect.checked,
    preferCdp: elements.preferCdp.checked,
    keepAttached: elements.keepAttached.checked,
    interceptDialogs: elements.interceptDialogs.checked,
    confirmDialogs: elements.confirmDialogs.checked,
    promptDialogText: elements.promptDialogText.value,
    autoSwitchNewTabs: elements.autoSwitchNewTabs.checked
  };
}

async function saveSettings() {
  const settings = readForm();
  if (!/^wss?:\/\//i.test(settings.serverUrl)) {
    setFeedback('The URL must start with ws:// or wss://.', 'bad');
    return;
  }
  setBusy(true);
  try {
    const response = await send('saveSettings', { settings, reconnect: true });
    if (!response.ok) throw new Error(response.error || 'Could not save.');
    fillForm(settings);
    renderStatus(response.status);
    setFeedback('Settings saved. Reconnecting…', 'ok');
  } catch (error) {
    setFeedback(error.message, 'bad');
  } finally {
    setBusy(false);
  }
}

async function connect() {
  setBusy(true);
  setFeedback('Connecting to MCP server…');
  try {
    const response = await send('connect');
    if (!response.ok) throw new Error(response.error || 'Failed to connect.');
    renderStatus(response.status);
    setFeedback('Connected.', 'ok');
  } catch (error) {
    setFeedback(error.message, 'bad');
    await refreshStatus();
  } finally {
    setBusy(false);
  }
}

async function disconnect() {
  setBusy(true);
  try {
    const response = await send('disconnect');
    if (!response.ok) throw new Error(response.error || 'Failed to disconnect.');
    setFeedback('Disconnected. Auto-reconnect is paused until you connect again.', 'ok');
    await refreshStatus();
  } catch (error) {
    setFeedback(error.message, 'bad');
  } finally {
    setBusy(false);
  }
}

async function detachDebugger() {
  setBusy(true);
  try {
    const response = await send('detachDebugger');
    if (!response.ok) throw new Error(response.error || 'Failed to detach.');
    const detached = response.result && Array.isArray(response.result.detached) ? response.result.detached : [];
    setFeedback(
      detached.length ? `Debugger detached from ${detached.length} tab(s).` : 'No tabs were attached.',
      'ok'
    );
    await refreshStatus();
  } catch (error) {
    setFeedback(error.message, 'bad');
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  elements.connectionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings();
  });

  elements.connectionForm.addEventListener('input', () => {
    formDirty = true;
  });

  for (const input of settingInputs) {
    input.addEventListener('change', () => {
      formDirty = true;
    });
  }

  elements.connectBtn.addEventListener('click', connect);
  elements.disconnectBtn.addEventListener('click', disconnect);
  elements.refreshBtn.addEventListener('click', () => refreshStatus(true));
  elements.detachBtn.addEventListener('click', detachDebugger);
  elements.extensionsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions' }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'status' && message.status) {
      renderStatus(message.status);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshStatus();
  });

  window.addEventListener('pagehide', () => {
    clearInterval(pollTimer);
  });
}

async function main() {
  bindEvents();
  const settings = await readStorage();
  fillForm(settings);
  await refreshStatus(true);
  pollTimer = setInterval(() => {
    if (!busy) refreshStatus();
  }, 5000);
}

main();