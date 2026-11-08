# `chrome_*` Tool Reference

All tools accept `tabId` when applicable. In sessions with more than one window or tab, pass `tabId` explicitly. `timeout` is in milliseconds.

## Session, Tabs, and Navigation

### `chrome_status`

No arguments. Returns bridge, extension version, connection, active tab, and tab list. Always use as the first call.

### `chrome_tabs`

| Argument | Values / Notes |
| --- | --- |
| `action` | `list`, `new`, `activate`, `close`, `get`, `reload`, `duplicate`, `pin`, `mute`, `unmute` |
| `tabId` | Target; defaults to active tab |
| `url` | For `new` |
| `active` | For `new`: focus the tab |
| `windowId` | For `new` |
| `waitUntil` | `none`, `commit`, `domcontentloaded` (default), `load`, `networkidle` |
| `timeout` | 1000–120000 |
| `bypassCache` | For `reload` |
| `pinned` | For `new` |

### `chrome_navigate`

| Argument | Values / Notes |
| --- | --- |
| `action` | `goto` (default), `back`, `forward`, `reload`, `stop` |
| `url` | Required for `goto`; bare domain becomes `https://` |
| `tabId` | Target |
| `newTab` | Open in new tab |
| `active` | Focus the tab; default `true` |
| `waitUntil` | `none`, `commit`, `domcontentloaded` (default), `load`, `networkidle` |
| `timeout` | 1000–120000; default 30000 |
| `bypassCache` | Reload ignoring cache |

### `chrome_debugger`

| Argument | Values / Notes |
| --- | --- |
| `action` | `status`, `attach`, `detach` |
| `tabId` | Target |

CDP enables trusted input, full-page screenshot, `evaluate`, upload, and emulation. Chrome shows a debug banner while attached.

## Reading and Inspection

### `chrome_visual`

Fast surface capture. Use this **first** before snapshot or DOM queries to understand the current visual state, see open modals/overlays/iframes, or verify a visual change.

| Argument | Values / Notes |
| --- | --- |
| `tabId` | Target |
| `fullPage` | Full scrollable page instead of viewport |
| `textOnly` | Return a text summary of visible modals/overlays instead of an image. Best for non-vision models |
| `quality` | 30–95 for JPEG; default 72 |
| `maxWidth` | 200–2560 px; default 1280 |
| `maxHeight` | 200–4000 px; default 900 |

### `chrome_cursor`

Single, primary tool for in-page navigation, pointing, hovering, and executing clicks. Moves the glowing orange cursor smoothly to the target element without needing manual coordinates.

Target: `ref` (preferred), `selector`, `text` (visible text/accessible name), or `x` + `y`.

| Argument | Values / Notes |
| --- | --- |
| `action` | `click` (default), `move`, `hover`, `show`, `hide` |
| `tabId`, `frameId` | Target |
| `ref` | Snapshot ref (e.g. `f0_e4`). Cursor moves automatically to element center |
| `selector` | CSS selector. Cursor moves automatically to element center |
| `text` | Visible text or accessible name to match. Moves automatically |
| `exactText` | Require exact text match |
| `x`, `y` | Direct viewport coordinates (optional fallback) |
| `button` | `left` (default), `right`, `middle` (for `action="click"`) |
| `clickCount` | 1–3 |
| `modifiers` | `Alt`, `Control`, `Meta`, `Shift`, `Option`, `Command` |
| `trusted` | `true` = real CDP input; `false` = DOM events |
| `animate` | Animate cursor movement; default `true` |
| `steps` | 1–30 animation steps; default 6 |
| `human` | Human-like mouse movement; default `false` (faster) |
| `waitUntil` | Load state after navigation; default `domcontentloaded` |
| `detectNavigationMs` | 100–5000; default 700 |
| `switchToNewTab` | Activate tab opened by the click |
| `delayAfter` | 0–5000 ms |
| `timeout` | 1000–120000; default 30000 |

### `chrome_snapshot`

| Argument | Values / Notes |
| --- | --- |
| `tabId` | Target |
| `frameId` | Frame; default 0 or the frame encoded in the ref |
| `allFrames` | Include iframes |
| `selector` | Restrict to a subtree |
| `mode` | `interactive` (default) or `full` |
| `maxNodes` | 20–2000; default 400 |
| `maxDepth` | 3–80; default 24 |
| `includeHidden` | Include hidden elements |
| `includeBboxes` | Include bounding boxes |
| `timeout` | 1000–120000; default 20000 |

Refs have the format `f<frame>_e<n>`, e.g., `f0_e12`.

### `chrome_screenshot`

| Argument | Values / Notes |
| --- | --- |
| `tabId`, `frameId` | Target |
| `fullPage` | Full page |
| `ref` or `selector` | Capture an element (do not use both) |
| `annotate` | Draw refs as labeled boxes |
| `grid` | 100 px grid |
| `format` | `png` (default) or `jpeg` |
| `quality` | 1–100 for JPEG |
| `maxWidth` | 200–6000 |
| `maxHeight` | 200–12000 |
| `trusted` | Force CDP on/off |
| `timeout` | 1000–180000; default 60000 |

### `chrome_dom`

| Argument | Values / Notes |
| --- | --- |
| `action` | `query`, `html`, `text`, `attributes`, `styles`, `rect`, `count` |
| `selector` | CSS; supports open shadow DOM with `host >>> internal` |
| `ref` | Snapshot ref |
| `xpath` | Alternative to CSS |
| `all` | All matches |
| `limit` | 1–100 |
| `includeHtml` | Include HTML in query result |
| `maxLength` | 100–30000 |
| `properties` | List of CSS properties for `styles` |
| `timeout` | 1000–60000; default 10000 |

### `chrome_evaluate`

| Argument | Values / Notes |
| --- | --- |
| `expression` | JavaScript; use IIFE for multiple statements |
| `frameId` | Frame |
| `awaitPromise` | Wait for Promise; default `true` |
| `returnByValue` | Return JSON; default `true` |
| `userGesture` | Simulate user gesture; default `true` |
| `trusted` | Use CDP |

Example: `(() => ({ title: document.title, links: [...document.querySelectorAll('a')].length }))()`.

## Interaction

Use `chrome_cursor` (default action `click`) for all pointing, clicks, and hovers.

### `chrome_type`

Target: `ref`, `selector`, or `focused`.

| Argument | Values / Notes |
| --- | --- |
| `text` | Required |
| `clear` | Clear before; default `true` |
| `delay` | 0–1000 ms per character |
| `natural` | `true` uses `Input.insertText` for fast realistic typing without DOM manipulation. Best for React/Vue/Angular inputs and long text |
| `pressEnter` | Send Enter at the end |
| `trusted` | CDP by default |
| `waitUntil` | Load state after Enter; default `domcontentloaded` |
| `timeout` | 1000–120000; default 30000 |
| `delayAfter` | 0–5000 ms |

Empty text + `pressEnter` on a focused button works as a click; prefer `chrome_cursor` when available.

### `chrome_press`

| Argument | Values / Notes |
| --- | --- |
| `ref` / `selector` | Focus the element first |
| `key` | `Enter` (default), `Tab`, `Escape`, `Backspace`, `ArrowDown`, `Control+A`, `Shift+Enter`, `F5`... |
| `trusted` | CDP by default |
| `delay` | 0–2000 ms |
| `noSubmit` | Do not submit form on Enter |
| `waitUntil` | Load state; default `domcontentloaded` |
| `timeout` | 1000–120000 |

### `chrome_select`

Target: `ref` or `selector`. Choose by `value`, `values`, `label`, `labels`, `index`, or `indexes`. For custom dropdowns, click the trigger then the option with `chrome_cursor`.

### `chrome_scroll`

| Argument | Values / Notes |
| --- | --- |
| `direction` | `up`, `down` (default), `left`, `right` |
| `amount` | 50–10000; default 600 |
| `to` | `top` or `bottom` |
| `ref` / `selector` | Bring element into view |
| `containerRef` / `containerSelector` | Scroll a container |
| `smooth` | Smooth scroll; default `false` (instant) |
| `trusted` | Wheel via CDP |

### `chrome_drag`

Source: `fromRef`, `fromSelector`, or `fromX` + `fromY`. Destination: `toRef`, `toSelector`, or `toX` + `toY`. Options: `steps` (2–80), `duration` (0–3000), `trusted`.

### `chrome_fill_form`

```json
{
  "tabId": 123,
  "fields": [
    { "ref": "f0_e3", "value": "Maria" },
    { "selector": "#email", "value": "maria@example.com" },
    { "selector": "#country", "type": "select", "value": "BR" },
    { "selector": "#terms", "type": "checkbox", "checked": true }
  ],
  "submit": { "selector": "button[type=submit]" }
}
```

Each field accepts `ref`/`selector`, `value`, `text`, `type` (`text`, `select`, `checkbox`, `radio`), `checked`, `values`, `label`, `index`, `clear`, `delay`, `pressEnter`, and `frameId`. General options: `trusted`, `continueOnError`, `timeout`.

### `chrome_upload_file`

| Argument | Values / Notes |
| --- | --- |
| `ref` / `selector` | `<input type="file">` |
| `files` | List of absolute paths on the machine running Chrome |
| `frameId` | Frame of the input |

Requires CDP and the main frame.

## Waiting and Observation

### `chrome_wait_for`

Provide at least one condition: `selector`, `text`, `urlIncludes`, `urlMatches`, `js`, or `loadState`.

| Argument | Values / Notes |
| --- | --- |
| `state` | `visible` (default), `attached`, `hidden`, `detached` |
| `exact` | Exact text match |
| `urlMatches` | JavaScript regex source |
| `js` | Expression/predicate |
| `loadState` | `commit`, `domcontentloaded`, `load`, `networkidle` |
| `timeout` | 100–120000; default 10000 |
| `interval` | 50–2000 ms; default 200 |
| `trusted` | Use CDP |

### `chrome_console`

| Argument | Values / Notes |
| --- | --- |
| `action` | `get` (default) or `clear` |
| `level` | `log`, `info`, `warn`, `error`, `debug` |
| `limit` | 1–400; default 200 |

### `chrome_network`

| Argument | Values / Notes |
| --- | --- |
| `action` | `get` (default) or `clear` |
| `filter` | URL substring |
| `type` | `fetch`, `xmlhttprequest`, `image`, etc. |
| `status` | HTTP status code |
| `includeStatic` | Include scripts/images/cache |
| `limit` | 1–400; default 200 |

## State and Environment

### `chrome_cookies`

| Argument | Values / Notes |
| --- | --- |
| `action` | `get` (default), `set`, `delete`, `clear` |
| `url` / `domain` | Required for read/clear; `url` recommended |
| `name` | Exact name; use for focused read |
| `value` | For `set` |
| `path` | Default `/` in `set` |
| `secure`, `httpOnly`, `sameSite` | Cookie attributes |
| `expirationDate` | Unix timestamp in seconds |
| `storeId` | Cookie store |

### `chrome_dialog`

| Argument | Values / Notes |
| --- | --- |
| `action` | `status`, `set_policy`, `clear` |
| `intercept` | Enable/disable interception |
| `confirm` | Auto-answer for `confirm()` |
| `prompt` | Text returned by `prompt()` |

### `chrome_emulate`

| Argument | Values / Notes |
| --- | --- |
| `action` | `set` (default), `reset` |
| `width`, `height` | 200–10000 |
| `deviceScaleFactor` | 0.5–4 |
| `mobile` | Emulate mobile |
| `userAgent` | String |
| `latitude`, `longitude`, `accuracy` | Geolocation |
| `colorScheme` | `light`, `dark` |
| `timezone` | e.g., `America/Sao_Paulo` |
| `offline` | Offline mode |
| `latency`, `downloadThroughput`, `uploadThroughput` | Network |

Requires CDP. Use `reset` to clear all overrides.