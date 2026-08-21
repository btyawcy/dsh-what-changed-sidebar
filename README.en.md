# dsh-what-changed-sidebar

**Agent file-change log as a [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) tab.** Grouped by turn; click a file to see before (red) / after (green) code blocks; auto-opens on edits (configurable).

> Requires [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) (>= 0.12.0, provides the `ctx.betterSidebar` service). Skips silently when better-sidebar is absent.

## Features

- **Sidebar tab**: registered as a "Change log" page in better-sidebar's "+" menu, replacing the session-header button
- **Grouped by turn**: all changes aggregated per "turn N", showing exactly what the agent did in each round
- **Tool-type tags**: each edit is labeled with its source tool (`edit` / `write` / `str_replace_editor`); new files are marked "Created"
- **Before red / after green blocks**: GitHub-style colors driven by theme tokens (light/dark aware), real line numbers per line (fallback clearly labeled "block-relative" when unavailable)
- **Lazy loading**: the projection stores only lightweight indexes (callId + metadata); full text is fetched from the session log on demand — projection size drops 90%+, full content only loaded when expanded
- **Auto-open (configurable)**: opens automatically on new file edits, once per turn; can be disabled in better-sidebar settings
- **Tab badge**: change count shown on the tab, no need to open
- **Search / open-in-editor / copy**: filter files by path, jump to a file in the editor, copy code blocks
- **Persisted collapse state**: per-session + per-path in localStorage, survives refresh
- **Honest gap notices**: shell writes that cannot be attributed to a file, and refused writes, are listed separately

## Security

- **Sensitive-file guard**: `.env`, `*credential*`, `*secret*`, `*.pem`, `*.key`, `id_rsa*`, etc. are recorded as "touched" only — content never enters the projection or the UI ("Sensitive file, content hidden")
- **No outbound network**: zero external requests; content is served only through a localhost HTTP route from the session log
- **Lazy-load fallback**: if content is unavailable (session closed), shows "Failed to load content" instead of crashing

## How it works

Data comes from `sessionProjections`, replayed live from the session log. The projection stores only lightweight indexes (per-edit `callId`, tool, turn, line numbers, sizes); full text stays in the session log. When an edit is expanded, the client fetches the complete diff from the host route `/api/what-changed/diff` by `callId`.

## Install

```sh
dsh plugin --profile web add dsh-what-changed-sidebar
```

Or install from a local path / GitHub repo:

```sh
dsh plugin --profile web add /path/to/dsh-what-changed-sidebar
dsh plugin --profile web add github:<your-user>/dsh-what-changed-sidebar
```

Restart `dsh web` (host projection + route require restart), then hard-refresh the browser.

## Relationship to dsh-what-changed

This plugin is a **presentation rework** of [dsh-what-changed](https://github.com/sjh9714/dsh-what-changed): it reuses the projection-collection approach but replaces the "header button + popup panel" with a better-sidebar tab, and adds lazy loading, sensitive-file protection, search / open-in-editor / copy, and more.

## License

MIT
