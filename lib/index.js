// src/index.ts
import { z } from "zod";

// src/projection.ts
var WRITERS = {
  // Minimal preset's editor. `create` carries file_text; the rest are edits.
  str_replace_editor: { path: "path", kind: "edit" },
  // Standard preset's pair.
  write: { path: "file_path", kind: "create" },
  edit: { path: "file_path", kind: "edit" }
};
var SHELLS = /* @__PURE__ */ new Set(["bash", "shell", "sh", "pwsh", "powershell", "cmd", "terminal", "run_command"]);
var SHELL_WRITES = [
  /\btee\b/,
  /\bsed\b[^|;&]*\s-[a-z]*i\b/,
  /\bperl\b[^|;&]*\s-[a-z]*i\b/,
  /\b(?:cp|mv|rm|mkdir|touch|install|truncate|ln)\s/,
  /\b(?:git\s+apply|patch|applypatch)\b/,
  // A python or node one-liner that opens for writing or uses a write helper.
  /\b(?:python3?|node)\b[^|;&]*\b(?:open\s*\([^)]*['"][wax]|writeFile|write_text|writelines)/,
  /\bdd\b[^|;&]*\bof=/
];
var REDIRECT = /(?:^|[^0-9<>&])>>?\s*(?!\s*(?:\/dev\/null\b|&))[^\s|;&<>]+/;
function outsideQuotes(command) {
  return command.replace(/'[^']*'|"[^"]*"/g, "");
}
function looksLikeShellWrite(command) {
  if (REDIRECT.test(outsideQuotes(command))) return true;
  return SHELL_WRITES.some((pattern) => pattern.test(command));
}
function commandOf(args) {
  let parsed;
  try {
    parsed = JSON.parse(args);
  } catch {
    return void 0;
  }
  if (typeof parsed !== "object" || parsed === null) return void 0;
  const record = parsed;
  for (const key of ["command", "cmd", "script", "input", "code"]) {
    const value = record[key];
    if (typeof value === "string" && value !== "") return value;
    if (Array.isArray(value) && value.every((part) => typeof part === "string")) {
      return value.join(" ");
    }
  }
  return void 0;
}

// 敏感文件黑名单：这些路径的内容不存投影、不展示（防密钥/凭据泄漏）。
var SENSITIVE_PATTERNS = [
  /(^|\/)\.[^/]*env[^/]*$/i,
  /(^|\/)\.env(\.[^/]*)?$/i,
  /(^|\/)[^/]*credential[^/]*$/i,
  /(^|\/)[^/]*secret[^/]*$/i,
  /(^|\/)[^/]*\.pem$/i,
  /(^|\/)[^/]*\.key$/i,
  /(^|\/)[^/]*\.p12$/i,
  /(^|\/)[^/]*\.pfx$/i,
  /(^|\/)[^/]*id_rsa[^/]*$/i,
  /(^|\/)[^/]*\.kubeconfig$/i,
  /(^|\/)[^/]*service-account[^/]*$/i,
  /(^|\/)[^/]*\.npmrc$/i,
  /(^|\/)[^/]*\.pypirc$/i,
  /(^|\/)[^/]*\.netrc$/i
];
function isSensitivePath(path) {
  if (typeof path !== "string" || path === "") return false;
  const lower = path.toLowerCase();
  return SENSITIVE_PATTERNS.some((re) => re.test(lower));
}

// 投影 state 必须是"无损 JSON"：session-projection-cache 在每个 turn/end 用
// snapshotJsonValue 把所有已注册投影的 state 一起写盘，Map/Set 或值为 undefined 的键
// 会让整条记录被拒（连 title/todos/stats 的检查点一起丢），所以这里只用普通对象、
// 数组和标量，可选字段一律省略而不是写 undefined。
function init() {
  return {
    pending: {},
    pendingShell: {},
    files: {},
    shells: [],
    totalEdits: 0,
    totalRefused: 0,
    shellWrites: 0
  };
}
function intent(name2, args, turn) {
  const writer = WRITERS[name2];
  if (writer === void 0) return void 0;
  let parsed;
  try {
    parsed = JSON.parse(args);
  } catch {
    return void 0;
  }
  if (typeof parsed !== "object" || parsed === null) return void 0;
  const path = parsed[writer.path];
  if (typeof path !== "string" || path === "") return void 0;
  const fileText = parsed.file_text ?? parsed.content;
  const oldStr = parsed.old_str;
  const newStr = parsed.new_str;
  return {
    path,
    tool: name2,
    kind: typeof fileText === "string" ? "create" : writer.kind,
    turn,
    ...typeof oldStr === "string" ? { oldText: oldStr } : {},
    ...typeof fileText === "string" ? { newText: fileText } : typeof newStr === "string" ? { newText: newStr } : {}
  };
}
function fileOf(state, path) {
  const existing = Object.hasOwn(state.files, path) ? state.files[path] : void 0;
  if (existing !== void 0) return existing;
  const created = { path, edits: [], refusals: [], sensitive: false };
  state.files[path] = created;
  return created;
}
// 中断的轮次会留下没有 result 的 call，pending 条目就永远不会被消费。
// 长会话里这会无界增长，所以按插入顺序裁掉最旧的。
var PENDING_LIMIT = 256;
// shell 索引也要有上限：一个长会话可能跑上千条写盘命令，投影会被整条写进
// projection cache，无界数组会把检查点越写越大。
var SHELL_LIMIT = 500;
function prune(record) {
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length - PENDING_LIMIT; i += 1) delete record[keys[i]];
}
function apply(state, event) {
  if (event.type === "tool/call") {
    const data2 = event.data;
    if (SHELLS.has(data2.name)) {
      const command = commandOf(data2.arguments);
      if (command !== void 0 && looksLikeShellWrite(command)) {
        // 只留命令的哈希用于同轮去重；原文不进投影（可能带 inline 凭据）。
        state.pendingShell[data2.callId] = { turn: data2.turn, tool: data2.name, hash: hashOf(command) };
        prune(state.pendingShell);
      }
      return state;
    }
    const write2 = intent(data2.name, data2.arguments, data2.turn);
    if (write2 === void 0) return state;
    state.pending[data2.callId] = write2;
    prune(state.pending);
    return state;
  }
  if (event.type !== "tool/result") return state;
  const data = event.data;
  const callId = data.message?.source?.callId;
  if (typeof callId !== "string") return state;
  if (Object.hasOwn(state.pendingShell, callId)) {
    const shell = state.pendingShell[callId];
    delete state.pendingShell[callId];
    if (data.error !== void 0) return state;
    const turn = typeof shell?.turn === "number" ? shell.turn : -1;
    const hash = typeof shell?.hash === "string" ? shell.hash : "";
    // 同一轮里完全相同的命令合并计数，不再重复列一遍。
    const same = hash === "" ? void 0 : state.shells.find((s) => s.turn === turn && s.hash === hash);
    if (same !== void 0) {
      same.repeat += 1;
      state.shellWrites += 1;
      return { ...state };
    }
    // 索引化：命令原文不进投影，只留 callId，展示时按 callId 从会话日志取回。
    state.shells.push({
      turn,
      tool: typeof shell?.tool === "string" ? shell.tool : "bash",
      callId,
      hash,
      repeat: 1
    });
    if (state.shells.length > SHELL_LIMIT) state.shells.splice(0, state.shells.length - SHELL_LIMIT);
    state.shellWrites += 1;
    return { ...state };
  }
  const write = Object.hasOwn(state.pending, callId) ? state.pending[callId] : void 0;
  if (write === void 0) return state;
  delete state.pending[callId];
  const file = fileOf(state, write.path);
  if (data.error !== void 0) {
    const err = data.error;
    const reason = typeof err === "object" && err !== null && typeof err.code === "string"
      ? err.code
      : typeof err === "object" && err !== null && typeof err.message === "string"
        ? err.message
        : "写入失败";
    file.refusals.push({
      turn: write.turn,
      tool: write.tool,
      reason
    });
    state.totalRefused += 1;
    return { ...state };
  }
  // 从 applied diff 取行号与文本；拿不到行号时退回 call 参数。
  const applied = appliedDiff(data.meta, write.path);
  const actualOld = applied?.oldText ?? write.oldText;
  const actualNew = applied?.newText ?? write.newText;
  const kind = actualOld === void 0 || actualOld === "" ? write.kind : "edit";
  const sensitive = isSensitivePath(write.path);
  // 索引化：投影只存轻量索引，全量文本留在会话日志里，展示时按 callId 取回。
  const rec = {
    turn: write.turn,
    tool: write.tool,
    kind,
    callId,
    source: applied === void 0 ? "arguments" : "applied",
    ...numKey("oldStart", applied?.oldStart),
    ...numKey("oldLines", applied?.oldLines),
    ...numKey("newStart", applied?.newStart),
    ...numKey("newLines", applied?.newLines),
    oldSize: actualOld === void 0 ? 0 : sizeOf(actualOld),
    newSize: actualNew === void 0 ? 0 : sizeOf(actualNew)
  };
  if (sensitive) {
    // 敏感文件：只记录"改过"，内容不进投影（避免缓存落盘泄漏）。
    file.sensitive = true;
    file.edits.push({ ...rec, sensitive: true, oldSize: 0, newSize: 0 });
  } else {
    file.edits.push(rec);
  }
  state.totalEdits += 1;
  return { ...state };
}
function numKey(key, v) {
  return typeof v === "number" && Number.isFinite(v) ? { [key]: v } : {};
}
// 命令去重用的短哈希（FNV-1a）。只用于"同一轮里是不是同一条命令"，
// 不是安全用途；存哈希而不是原文，避免把命令内容写进会被缓存落盘的投影。
function hashOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
function sizeOf(text) {
  if (typeof text !== "string") return 0;
  return Buffer.byteLength(text, "utf8");
}
function appliedDiff(meta, path) {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return void 0;
  const diffs = meta.diffs;
  if (!Array.isArray(diffs)) return void 0;
  for (const entry of diffs) {
    if (typeof entry !== "object" || entry === null) continue;
    if (entry.path !== path) continue;
    const oldText = typeof entry.oldText === "string" ? entry.oldText : void 0;
    const newText = typeof entry.newText === "string" ? entry.newText : void 0;
    if (oldText === void 0 && newText === void 0) continue;
    return {
      ...oldText === void 0 ? {} : { oldText },
      ...newText === void 0 ? {} : { newText },
      ...typeof entry.oldStart === "number" ? { oldStart: entry.oldStart } : {},
      ...typeof entry.oldLines === "number" ? { oldLines: entry.oldLines } : {},
      ...typeof entry.newStart === "number" ? { newStart: entry.newStart } : {},
      ...typeof entry.newLines === "number" ? { newLines: entry.newLines } : {}
    };
  }
  return void 0;
}
function view(state) {
  // 复制一层：投影内部的 file 对象是就地 push 的，直接交出去会让读侧拿到会变的引用。
  // 同时给每处编辑标上"这个文件的第几次修改"（seq，按时间正序编号，从 1 开始），
  // 然后整段倒序交出去：读侧永远是新的在上，不用往下翻。
  const files = Object.values(state.files)
    .filter((file) => file.edits.length > 0 || file.refusals.length > 0)
    .sort((a, b) => lastTurn(b) - lastTurn(a))
    .map((file) => ({
      path: file.path,
      edits: file.edits.map((edit, index) => ({ ...edit, seq: index + 1, of: file.edits.length })).reverse(),
      refusals: file.refusals.map((r, index) => ({ ...r, seq: index + 1 })).reverse(),
      sensitive: file.sensitive
    }));
  return {
    files,
    // shell 写入同样新→旧。
    shells: state.shells.slice().reverse(),
    totalEdits: state.totalEdits,
    totalRefused: state.totalRefused,
    shellWrites: state.shellWrites
  };
}
function lastTurn(file) {
  let last = -1;
  for (const edit of file.edits) if (edit.turn > last) last = edit.turn;
  for (const r of file.refusals) if (r.turn > last) last = r.turn;
  return last;
}

// src/index.ts
var editSchema = z.object({
  turn: z.number(),
  tool: z.string(),
  kind: z.union([z.literal("edit"), z.literal("create")]),
  callId: z.string(),
  source: z.enum(["arguments", "applied"]),
  oldStart: z.number().optional(),
  oldLines: z.number().optional(),
  newStart: z.number().optional(),
  newLines: z.number().optional(),
  oldSize: z.number(),
  newSize: z.number(),
  sensitive: z.boolean().optional(),
  // 这个文件的第几次修改 / 共几次（view 里编号，时间正序）。
  seq: z.number(),
  of: z.number()
});
var refusalSchema = z.object({
  turn: z.number(),
  tool: z.string(),
  reason: z.string(),
  seq: z.number()
});
var fileSchema = z.object({
  path: z.string(),
  edits: z.array(editSchema),
  refusals: z.array(refusalSchema),
  sensitive: z.boolean().optional()
});
// 一条被判定为"写了文件"的 shell 命令：只存索引，原文按 callId 懒加载。
var shellSchema = z.object({
  turn: z.number(),
  tool: z.string(),
  callId: z.string(),
  hash: z.string(),
  repeat: z.number()
});
var schema = z.object({
  files: z.array(fileSchema),
  shells: z.array(shellSchema),
  totalEdits: z.number(),
  totalRefused: z.number(),
  shellWrites: z.number()
});
var whatChangedProjection = {
  key: "whatChangedSidebar",
  schema,
  init,
  apply: (state, event) => apply(state, event),
  view,
  // v8: 每处改动带 seq/of 编号且 view 里改为新→旧倒序；shell 写入从计数器换成
  // 带 turn/callId 的索引数组（原文仍按 callId 懒加载，不进投影）。
  stateVersion: 8
};
var name = "dsh-what-changed-sidebar";
// 投影 + RPC 路由所需服务。webServer/sessions/sessionPersistence 是 dsh web
// 环境的必然服务，放 inject 里确保 RPC 路由注册时服务已就绪（同 better-sidebar）。
var inject = ["sessionProjections", "webServer", "sessions", "sessionPersistence"];
function readJsonBody(req) {
  return new Promise(function (resolve) {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on("data", (c) => {
      size += c.length;
      // 这条路由的 body 只有三个短字符串；超过 64 KiB 一定不是它，直接丢弃不缓冲。
      if (size > 65536) {
        finish(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        finish(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        finish(null);
      }
    });
    req.on("error", () => finish(null));
    req.on("aborted", () => finish(null));
  });
}
function writeJson(res, status, payload) {
  if (res.headersSent === true) return;
  res.writeHead(status, {
    "content-type": "application/json",
    // 侧边栏读的是当前进程的会话日志，任何缓存都可能给出过期 diff。
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}
// 从事件数组按 callId 取回一处编辑的全量 diff 文本。
// 投影只存索引，全量内容留在日志里，这里按需取回（懒加载）。
// 匹配到 callId 但没有内容时继续往后找，不提前放弃：同一 callId 在日志里可能出现
// 多条 tool/result（重放、多路径 diff），提前 return 会把能取到的内容判成"加载失败"。
function findDiffInEvents(events, callId, path) {
  if (!Array.isArray(events)) return void 0;
  for (const ev of events) {
    if (ev.type !== "tool/result") continue;
    const data = ev.data;
    const cid = data?.message?.source?.callId;
    if (cid !== callId) continue;
    const meta = data?.meta;
    if (typeof meta !== "object" || meta === null) continue;
    const diffs = meta.diffs;
    if (!Array.isArray(diffs)) continue;
    for (const entry of diffs) {
      if (typeof entry !== "object" || entry === null) continue;
      if (entry.path !== path) continue;
      const oldText = typeof entry.oldText === "string" ? entry.oldText : void 0;
      const newText = typeof entry.newText === "string" ? entry.newText : void 0;
      if (oldText === void 0 && newText === void 0) continue;
      return {
        oldText,
        newText,
        oldStart: typeof entry.oldStart === "number" ? entry.oldStart : void 0,
        oldLines: typeof entry.oldLines === "number" ? entry.oldLines : void 0,
        newStart: typeof entry.newStart === "number" ? entry.newStart : void 0,
        newLines: typeof entry.newLines === "number" ? entry.newLines : void 0
      };
    }
  }
  return void 0;
}
// 回退路径：某些写入的 tool/result 不带 meta.diffs（例如某些 write 调用），
// 此时从对应的 tool/call 参数里取内容。没有行号，客户端会按"块内相对行号"显示。
function findDiffInCall(events, callId, path) {
  if (!Array.isArray(events)) return void 0;
  for (const ev of events) {
    if (ev.type !== "tool/call") continue;
    const data = ev.data;
    if (data?.callId !== callId) continue;
    const write = intent(data.name, data.arguments, data.turn);
    if (write === void 0 || write.path !== path) return void 0;
    if (write.oldText === void 0 && write.newText === void 0) return void 0;
    return { oldText: write.oldText, newText: write.newText };
  }
  return void 0;
}
// 按 callId 取回一条 shell 命令的原文。命令原文不进投影（可能带 inline 凭据，
// 投影会被 projection cache 写盘，等于多一份磁盘副本）；日志里本来就有，
// 读出来显示不新增暴露面。
function findCommandInEvents(events, callId) {
  if (!Array.isArray(events)) return void 0;
  for (const ev of events) {
    if (ev.type !== "tool/call") continue;
    const data = ev.data;
    if (data?.callId !== callId) continue;
    const command = commandOf(data.arguments);
    if (typeof command !== "string" || command === "") return void 0;
    return command;
  }
  return void 0;
}
// heredoc 正文是数据不是命令：`cat > x.mjs <<'EOF' … EOF` 中间那段可能是一份
// 脚本或一段文本，里面出现 ".env" 只是提到这个名字，不代表这条命令读写了它。
// 判断敏感性前先把 heredoc 段落剥掉，否则任何"讨论敏感文件"的脚本都会被误伤。
function stripHeredocs(command) {
  // <<EOF / <<-EOF / <<'EOF' / <<"EOF"（可带 - 和引号），到同名单独一行结束。
  const open = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;
  let result = "";
  let cursor = 0;
  let match = open.exec(command);
  while (match !== null) {
    const tag = match[2];
    result += command.slice(cursor, match.index);
    // 从 heredoc 开始处找那一行的结尾，再找关闭标签所在行。
    const afterOpen = match.index + match[0].length;
    const bodyStart = command.indexOf("\n", afterOpen);
    if (bodyStart === -1) {
      cursor = command.length;
      break;
    }
    const close = new RegExp("^[ \\t]*" + tag + "[ \\t]*$", "m");
    const rest = command.slice(bodyStart + 1);
    const hit = close.exec(rest);
    cursor = hit === null ? command.length : bodyStart + 1 + hit.index + hit[0].length;
    open.lastIndex = cursor;
    match = open.exec(command);
  }
  return result + command.slice(cursor);
}
// 一个 token 要被当成"路径"才参与敏感判断：必须像路径（含 / 或 . 或 ~），
// 且不含 CJK / 空白类残留。否则 `not-a-real-secret` 这种值、
// `xxx.env（敏感文件）` 这种黏了中文的片段都会被误判。
function looksLikePathToken(token) {
  if (token.length === 0 || token.length > 512) return false;
  if (/[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(token)) return false;
  return token.includes("/") || token.includes(".") || token.startsWith("~");
}
// 命令里确实读写了敏感文件时不给原文：`cat .env > dump` 这类命令本身就是内容出口。
// SENSITIVE_PATTERNS 以 `$` 结尾（按整条路径匹配），所以先把命令切成 token，
// 再逐个当作路径判断。只做这一个机械判断，不猜哪一段是密钥。
var TOKEN_SPLIT = /[\s;|&()<>"'`$={},]+/;
function commandTouchesSensitive(command) {
  const tokens = stripHeredocs(command).split(TOKEN_SPLIT);
  for (const token of tokens) {
    if (token === "") continue;
    // 去掉重定向残留和行尾标点，`>>~/.npmrc` 这种要还原成路径再判断。
    const cleaned = token.replace(/^[>~]+/, "").replace(/[:,]+$/, "");
    if (looksLikePathToken(token) && isSensitivePath(token)) return true;
    if (looksLikePathToken(cleaned) && isSensitivePath(cleaned)) return true;
  }
  return false;
}
function apply2(ctx) {
  ctx.sessionProjections.register(whatChangedProjection);
  const webServer = ctx.webServer;
  const sessions = ctx.sessions;
  const persistence = ctx.sessionPersistence;
  // 活跃 session 的内存事件优先；冷会话回退 sessionPersistence 读持久化日志。
  // inspect 返回 {meta, events}，readFrom 是它的按序读原语。
  const eventsOf = async (sessionId) => {
    const session = typeof sessions.get === "function" ? sessions.get(sessionId) : void 0;
    if (session !== void 0 && Array.isArray(session.events)) return session.events;
    if (persistence === void 0) return void 0;
    try {
      if (typeof persistence.inspect === "function") {
        const inspected = await persistence.inspect(sessionId);
        if (inspected !== void 0 && Array.isArray(inspected.events)) return inspected.events;
      }
      if (typeof persistence.readFrom === "function") {
        const read = await persistence.readFrom(sessionId, 0);
        if (read !== void 0 && Array.isArray(read.events)) return read.events;
      }
    } catch (e) { /* cold read failed */ }
    return void 0;
  };
  if (webServer !== void 0 && sessions !== void 0) {
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/api/what-changed/diff",
      handler: async (req, res) => {
        try {
          if (req.method !== "POST") {
            writeJson(res, 405, { ok: false, error: "method not allowed" });
            return;
          }
          const body = await readJsonBody(req);
          if (
            body === null ||
            typeof body.sessionId !== "string" || body.sessionId === "" ||
            typeof body.callId !== "string" || body.callId === ""
          ) {
            writeJson(res, 400, { ok: false, error: "sessionId and callId are required" });
            return;
          }
          const wantsCommand = body.kind === "command";
          if (!wantsCommand && (typeof body.path !== "string" || body.path === "")) {
            writeJson(res, 400, { ok: false, error: "path is required for a diff read" });
            return;
          }
          // 敏感文件的内容永不经这条路由离开进程：投影已隐藏，路由必须同样拒绝，
          // 否则本地任何人都能用 callId 直接把 .env / 私钥内容读回来。
          if (!wantsCommand && isSensitivePath(body.path)) {
            writeJson(res, 403, { ok: false, error: "sensitive path" });
            return;
          }
          const events = await eventsOf(body.sessionId);
          if (events === void 0) {
            writeJson(res, 404, { ok: false, error: "session log unavailable" });
            return;
          }
          if (wantsCommand) {
            const command = findCommandInEvents(events, body.callId);
            if (command === void 0) {
              writeJson(res, 404, { ok: false, error: "command not found" });
              return;
            }
            if (commandTouchesSensitive(command)) {
              writeJson(res, 200, { ok: true, value: { redacted: true } });
              return;
            }
            writeJson(res, 200, { ok: true, value: { command } });
            return;
          }
          const diff = findDiffInEvents(events, body.callId, body.path)
            ?? findDiffInCall(events, body.callId, body.path);
          if (diff === void 0 || (diff.oldText === void 0 && diff.newText === void 0)) {
            writeJson(res, 404, { ok: false, error: "diff not found" });
            return;
          }
          writeJson(res, 200, { ok: true, value: diff });
        } catch (e) {
          // 一条侧边栏读路由不该把 web server 拖挂。
          try { writeJson(res, 500, { ok: false, error: "internal error" }); } catch (e2) { /* headers sent */ }
        }
      }
    }), "dsh-what-changed-sidebar: diff route");
  }
}
export {
  apply2 as apply,
  inject,
  name,
  whatChangedProjection
};
