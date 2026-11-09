# DSH Browser Bridge — DSH bundle

A DeepSeek Harness bundle that runs the DSH Browser Bridge MCP server, so the
agent gets the `chrome_*` tools (`mcp__chrome__*` in the Harness) and can drive a real
Chrome through the extension shipped in `extension/`.

Everything needed is inside this folder: the MCP server, the Chrome extension, the
Loader patch, and the display resources.

```text
dsh-plugin/
├── cordis.patch.yml   # inserts @deepseek-ai/dsh-mcp-client -> server/src/index.js
├── locale/            # Plugin Manager title and description
├── icon.svg
├── server/            # MCP server (stdio) + loopback WebSocket bridge
└── extension/         # Chrome MV3 extension ("Load unpacked")
```

## Install

Install this directory as a bundle in the current profile:

```text
plugin_manager action=install_bundle target=/absolute/path/to/dsh-plugin
```

The patch resolves the server path from `DSH_PROFILE_DIR` at mount time, so the
package keeps working wherever the profile links it.

## Chrome side

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
   and select `dsh-plugin/extension`.
2. Open the extension popup: it shows **Connected** once the Harness started the
   server. The popup port must match `DSH_BROWSER_PORT` in `cordis.patch.yml`
   (default `8787`).

## Notes

- `serverName: chrome` produces tool names `mcp__chrome__<tool>`. Only one row per
  profile may use that name; disable any other hand-written `dsh-mcp-client` row
  pointing at this bridge before installing.
- The extension needs the `debugger` permission, so Chrome shows the
  "started debugging this browser" banner while CDP is attached.
- Tool results (screenshots, HTML, cookies, logs) go to the model provider you use.
- `server/` and `extension/` are self-contained copies with their own
  `node_modules`; the profile links this folder, so edits made here are the ones
  that run.
