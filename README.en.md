# dsh-what-changed-sidebar

**Agent file-change log as a [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) tab.** Grouped by turn, newest first; click a file to see before (red) / after (green) code blocks; auto-opens on edits (configurable).

> Requires [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) (>= 0.12.0, provides the `ctx.betterSidebar` service). Skips silently when better-sidebar is absent, without affecting DSH startup.

## Features

- **Sidebar tab**: registered as a "Changes" page in better-sidebar's "+" menu, single-instance (a repeated open focuses the existing tab)
- **Newest first**: turns descend, and multiple edits to the same file are ordered newest-first too — no scrolling down to find the latest
- **Edit numbering**: when a file is edited several times in one turn, each block is labeled "edit 3 of 4" with a "latest" badge on the newest; a single edit carries no label
- **Tool-type tags**: each edit is labeled with its source tool (`edit` / `write` / `str_replace_editor`); new files are also marked "Created"
- **Before red / after green blocks**: GitHub-style colors driven by theme tokens (light/dark aware), real line numbers per line; when absolute numbers are unavailable the block is clearly labeled "block lines"
- **Lazy loading**: the projection stores only lightweight indexes (`callId` + metadata); full text is fetched from the session log on demand
- **Shell writes listed per turn**: commands that look like they wrote files land in their own turn (after the file changes), collapsed, showing `$ command text`; identical commands in one turn collapse to `×N`
- **Auto-open (configurable)**: opens on new edits, once per turn; can be switched off in better-sidebar settings (on by default)
- **Tab badge**: total change count on the tab
- **Search / open-in-editor / copy**: filter files by path (button-triggered, not instant), jump to a file in the editor, copy code blocks and commands
- **Refused writes listed separately**: writes denied by the sandbox or permissions form their own group with the reason

## Security

- **Sensitive-file guard**: `.env`, `*credential*`, `*secret*`, `*.pem`, `*.key`, `id_rsa*`, `.npmrc`, `.netrc` and friends are recorded as "touched" only — content never enters the projection or the UI, and the fetch route rejects them with 403
- **Command text never enters the projection**: a shell command may carry inline credentials and the projection is persisted by `session-projection-cache`; only the `callId` and a short dedup hash are stored, with the text read from the log on demand
- **Command-level redaction**: when a command really reads or writes a sensitive file (judged on path-shaped tokens after stripping heredoc bodies) the whole line is hidden; no guessing which fragment is a secret
- **No outbound network**: zero external requests; content is served only through a localhost HTTP route from the session log
- **Plain-JSON projection state**: the state contains no `Map`/`Set` and no `undefined`-valued keys, so `session-projection-cache`'s lossless-JSON check passes (a rejection would drop the whole session checkpoint, built-in projections included)
- **Bounded growth**: unfinished pending calls and the shell index are both capped, so a long session cannot blow up the checkpoint

## How it works

Data comes from `sessionProjections`, replayed live from the session log. The projection stores only lightweight indexes (per-edit `callId`, tool, turn, line numbers, sizes); on expansion the client fetches the complete diff or command text from the host route `/api/what-changed/diff` by `callId`.

Absolute line numbers come from the applied diff a write tool reports in `tool/result`. Some `write` calls carry no such metadata; the route then falls back to the `tool/call` arguments, and line numbers degrade to block-relative with that stated in the UI.

## Install

```sh
dsh plugin --profile web add dsh-what-changed-sidebar
```

Or install from a local path / GitHub repo:

```sh
dsh plugin --profile web add /path/to/dsh-what-changed-sidebar
dsh plugin --profile web add github:btyawcy/dsh-what-changed-sidebar
```

Restart `dsh web` (the host-half projection and route need a fresh process), then hard-refresh the browser.

## Relationship to dsh-what-changed

This plugin is a **presentation rework** of [dsh-what-changed](https://github.com/sjh9714/dsh-what-changed): it reuses the projection-collection approach but replaces the "header button + popup panel" with a better-sidebar tab, and adds newest-first ordering with edit numbering, index-only lazy loading, shell command text, sensitive-content protection, and search / open-in-editor / copy.

## License

MIT
