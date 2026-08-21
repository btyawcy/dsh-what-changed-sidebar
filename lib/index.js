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

// 单处编辑文本上限：超出截断（保留头尾），标注省略。
var MAX_EDIT_TEXT = 32 * 1024;

function init() {
  return {
    pending: /* @__PURE__ */ new Map(),
    pendingShell: /* @__PURE__ */ new Set(),
    files: /* @__PURE__ */ new Map(),
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
  const existing = state.files.get(path);
  if (existing !== void 0) return existing;
  const created = { path, edits: [], refusals: [], sensitive: false };
  state.files.set(path, created);
  return created;
}
function apply(state, event) {
  if (event.type === "tool/call") {
    const data2 = event.data;
    if (SHELLS.has(data2.name)) {
      const command = commandOf(data2.arguments);
      if (command !== void 0 && looksLikeShellWrite(command)) state.pendingShell.add(data2.callId);
      return state;
    }
    const write2 = intent(data2.name, data2.arguments, data2.turn);
    if (write2 === void 0) return state;
    state.pending.set(data2.callId, write2);
    return state;
  }
  if (event.type !== "tool/result") return state;
  const data = event.data;
  const callId = data.message?.source?.callId;
  if (typeof callId !== "string") return state;
  if (state.pendingShell.has(callId)) {
    state.pendingShell.delete(callId);
    if (data.error !== void 0) return state;
    state.shellWrites += 1;
    return { ...state };
  }
  const write = state.pending.get(callId);
  if (write === void 0) return state;
  state.pending.delete(callId);
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
    oldStart: numOrUndef(applied?.oldStart),
    oldLines: numOrUndef(applied?.oldLines),
    newStart: numOrUndef(applied?.newStart),
    newLines: numOrUndef(applied?.newLines),
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
function numOrUndef(v) {
  return typeof v === "number" ? v : void 0;
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
  const files = [...state.files.values()].filter((file) => file.edits.length > 0 || file.refusals.length > 0).sort((a, b) => lastTurn(b) - lastTurn(a));
  return {
    files,
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
  sensitive: z.boolean().optional()
});
var refusalSchema = z.object({
  turn: z.number(),
  tool: z.string(),
  reason: z.string()
});
var fileSchema = z.object({
  path: z.string(),
  edits: z.array(editSchema),
  refusals: z.array(refusalSchema),
  sensitive: z.boolean().optional()
});
var schema = z.object({
  files: z.array(fileSchema),
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
  // v6: 索引化 — 投影不再存全量文本，只存 callId + 元数据；全量按需从会话日志取。
  stateVersion: 6
};
var name = "dsh-what-changed-sidebar";
// 投影是硬依赖（必须注册）；webServer/sessions/sessionPersistence 用 ctx.get
// 可选读，不放进 inject —— 避免某环境缺这些服务时投影也被阻塞。
var inject = ["sessionProjections"];
function readJsonBody(req) {
  return new Promise(function (resolve) {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}
function writeJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}
// 从事件数组按 callId 取回一处编辑的全量 diff 文本。
// 投影只存索引，全量内容留在日志里，这里按需取回（懒加载）。
function findDiffInEvents(events, callId, path) {
  if (!Array.isArray(events)) return void 0;
  for (const ev of events) {
    if (ev.type !== "tool/result") continue;
    const data = ev.data;
    const cid = data?.message?.source?.callId;
    if (cid !== callId) continue;
    const meta = data?.meta;
    if (typeof meta !== "object" || meta === null) return void 0;
    const diffs = meta.diffs;
    if (!Array.isArray(diffs)) return void 0;
    for (const entry of diffs) {
      if (typeof entry !== "object" || entry === null) continue;
      if (entry.path !== path) continue;
      return {
        oldText: typeof entry.oldText === "string" ? entry.oldText : void 0,
        newText: typeof entry.newText === "string" ? entry.newText : void 0,
        oldStart: typeof entry.oldStart === "number" ? entry.oldStart : void 0,
        oldLines: typeof entry.oldLines === "number" ? entry.oldLines : void 0,
        newStart: typeof entry.newStart === "number" ? entry.newStart : void 0,
        newLines: typeof entry.newLines === "number" ? entry.newLines : void 0
      };
    }
    return void 0;
  }
  return void 0;
}
function apply2(ctx) {
  ctx.sessionProjections.register(whatChangedProjection);
  const webServer = ctx.get("webServer");
  const sessions = ctx.get("sessions");
  const persistence = ctx.get("sessionPersistence");
  if (webServer !== void 0 && sessions !== void 0) {
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/api/what-changed/diff",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          writeJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        const body = await readJsonBody(req);
        if (body === null || typeof body.callId !== "string" || typeof body.path !== "string") {
          writeJson(res, 400, { ok: false, error: "callId and path are required" });
          return;
        }
        // 优先活跃 session 的内存事件；冷会话（未加载）回退 sessionPersistence.inspect 读持久化完整日志。
        const session = sessions.get(body.sessionId);
        let events = void 0;
        if (session !== void 0 && Array.isArray(session.events)) {
          events = session.events;
        } else if (persistence !== void 0 && typeof persistence.inspect === "function") {
          try {
            const inspected = await persistence.inspect(body.sessionId);
            if (inspected !== void 0) {
              events = inspected.log || inspected.events;
            }
          } catch (e) { /* cold read failed */ }
        }
        if (events === void 0) {
          writeJson(res, 404, { ok: false, error: "session log unavailable" });
          return;
        }
        const diff = findDiffInEvents(events, body.callId, body.path);
        if (diff === void 0 || (diff.oldText === void 0 && diff.newText === void 0)) {
          writeJson(res, 404, { ok: false, error: "diff not found" });
          return;
        }
        writeJson(res, 200, { ok: true, value: diff });
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
