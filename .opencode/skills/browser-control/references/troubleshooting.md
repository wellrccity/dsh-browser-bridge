# Troubleshooting and Recovery

## Check Order

1. `chrome_status` — shows bridge, extension version, tabs, and active tab.
2. Extension popup — must show **Connected** and the same port as the server.
3. `opencode mcp list` — the `chrome` server should appear as connected.
4. If the connection dropped after reloading the extension, wait a few seconds; the service worker reconnects automatically. If it doesn't come back, open the popup and click **Connect**.
5. If the problem persists, reload the extension at `chrome://extensions`.

The server is started by OpenCode. **Do not** run another `node server/src/index.js` on the same port.

## Extension Shows "Disconnected"

- Confirm that OpenCode is open and the MCP `chrome` server is connected (`opencode mcp list`).
- Check the URL in the popup: default `ws://127.0.0.1:8787`.
- If a token is used, it must match `DSH_BROWSER_TOKEN` in the server environment.
- Reload the extension and click **Connect** in the popup.
- Check the OpenCode log at `~/.local/share/opencode/log/opencode.log` and search for `mcp connected`, `extension ready`, or `extension disconnected`.

## Only Some `chrome_*` Tools Appear

Symptom: the server is connected, but the session only shows a subset (for example, missing `chrome_navigate`, `chrome_click`, or `chrome_screenshot`).

Most common cause: the MCP server was configured with the name `browser`. OpenCode V2 has a native `browser` namespace (denied by the default `browser` permission), and MCP tools with the same names are shadowed. Rename the key in `mcp.servers` to `chrome`, run `opencode reload`, and open a **new session**.

If the name is already `chrome` and tools are still missing, it may be the MCP catalog cache per session: open a **new session** in the same directory. No need to reinstall the extension or the server.

To check the total number of tools registered by the server:

```powershell
opencode mcp list
```

The current server registers 24 tools.

## `TIMEOUT`

The command did not respond within the deadline. Possible causes:

1. **Native dialog open.** Check `chrome_dialog` with `action="status"`. If the tab is blocked and the command does not respond, close the tab or ask the user to press Enter/Escape. Confirm the popup shows **Intercept dialogs** as active.
2. **Slow navigation.** Use `chrome_wait_for` with `loadState="domcontentloaded"` or `selector` instead of waiting for `load`.
3. **Service worker suspended.** The bridge should reconnect; try `chrome_status` again. If it persists, open the popup and click **Connect**.
4. **Pending CDP command.** Use `chrome_debugger` with `action="detach"` on the tab and try again. If the problem repeats, reload the tab.

## `PAGE_NOT_SCRIPTABLE`

The tab is restricted: `chrome://`, Chrome Web Store, Chrome internal pages, or extension pages. Use a normal `http(s)` URL. For `file://`, enable **Allow access to file URLs** in the extension settings.

## `DEBUGGER_BUSY`

DevTools or another debugger is already attached to the tab. Close DevTools and try again. Without CDP, use `trusted:false` for synthetic input; some functions (full-page screenshot, upload, and emulation) require CDP.

## Ref Not Found or Stale

The DOM tree changed. Take a new `chrome_snapshot` and use the new refs. Do not reuse refs from old snapshots. For open shadow DOM, use `host >>> internal`; for iframes, use `allFrames=true` and the `frameId` encoded in the ref.

## Upload Fails

- Use **absolute paths** on the machine running Chrome.
- The input must be `<input type="file">` and preferably in the main frame.
- Confirm CDP is active (`chrome_debugger` with `action="status"`).
- If the input is in an iframe, open the iframe content directly or use an alternative strategy.

## Full-Page Screenshot with Repeated Headers

Without CDP, the capture is done in parts and `position: fixed` elements may appear repeated. Use CDP (`trusted`/`preferCdp`) for native capture. Very tall pages may be reduced by the `maxHeight` limit.

## Native Dialogs Blocking

- Enable **Intercept dialogs** in the popup.
- Use `chrome_dialog` with `action="status"` to see the log and policy.
- `chrome_dialog` with `action="set_policy"` allows setting `intercept`, `confirm`, and the `prompt` response.
- If a native dialog is already open, the command may not respond; close the tab or ask the user to dismiss the dialog.

## `PORT_IN_USE`

Another process is using the port. Do not start a second instance without need. Find the process:

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess
```

If you need to change the port, update `DSH_BROWSER_PORT` in `opencode.jsonc` **and** the URL in the extension popup.

## Agent Doesn't See the Browser or Acts on the Wrong Tab

- Call `chrome_status` and pass `tabId` explicitly.
- The active tab may be the OpenCode UI or a personal tab. Do not use `chrome://` as a target.
- With multiple windows, confirm the `windowId` and the tab by title/URL before acting.
- After a click that opens a new tab, use `chrome_tabs`/`chrome_wait_for` to locate the new tab.

## Quick Project Tests

```powershell
npm run check   # syntax, manifest, icons, and config
npm test        # bridge and MCP server
```

The integration test uses a simulated extension; it does not replace a test in real Chrome.