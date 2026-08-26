import { z } from "zod";
import { writeFile as fsWriteFile, rename as fsRename, mkdir as fsMkdir } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

// ── trust fence（移植自 dsh-better-sidebar 的 src/trust-fence.ts，同款语义）──
// 防 DNS rebinding 与恶意页面跨站请求：Host 必须是 loopback 或受信主机，
// 且浏览器标记（sec-fetch-site / origin）必须同源。没有这层，任何网页都
// 可以借浏览器之手读走本机文件。
function headerOf(headers, name) {
  const value = headers[name];
  return typeof value === "string" ? value : void 0;
}
function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`);
  } catch {
    return void 0;
  }
}
function isLoopbackHostname(hostname) {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function canonicalAuthority(entry, entryUrl) {
  const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
  return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
function isTrustedAuthority(hostUrl, trustedHosts) {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry);
    if (entryUrl === void 0) return false;
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host;
  });
}
function isTrustedApiRequest(request, trustedHosts) {
  const host = headerOf(request.headers, "host");
  if (host === void 0) return false;
  const hostUrl = parseAuthority(host);
  if (hostUrl === void 0) return false;
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
  if (headerOf(request.headers, "sec-fetch-site") === "cross-site") return false;
  const origin = headerOf(request.headers, "origin");
  if (origin === void 0) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

// 文本写入工具：有 applied diff 或参数文本，能渲染真实对比。
var WRITERS = {
  // Minimal preset's editor. `create` carries file_text; the rest are edits.
  str_replace_editor: { path: "path", kind: "edit" },
  // Standard preset's pair.
  write: { path: "file_path", kind: "create" },
  edit: { path: "file_path", kind: "edit" }
};
// 已知的"结构化写入"工具：改文件但不产生文本 diff（记 noText，客户端显示
// 中性提示）。没安装对应插件时这些工具名根本不会出现在日志里，条目纯惰性；
// 要支持其他同类工具在这里加一行（工具名 → 路径参数名）即可。会报告
// meta.diffs 的工具**无需登记**——它们走泛化追踪，自动被覆盖。
var STRUCTURED_WRITERS = {
  univer_new: { path: "file", kind: "create" },
  univer_import: { path: "file", kind: "create" },
  univer_execute: { path: "file", kind: "edit" },
  univer_compile_svg: { path: "file", kind: "edit" },
  univer_unit: { path: "file", kind: "edit" },
  univer_export: { path: "output", kind: "create" }
};
var SHELLS = /* @__PURE__ */ new Set(["bash", "shell", "sh", "pwsh", "powershell", "cmd", "terminal", "run_command"]);
var SHELL_WRITES = [
  /\btee\b/,
  /\bsed\b[^|;&]*\s-[a-z]*i\b/,
  /\bperl\b[^|;&]*\s-[a-z]*i\b/,
  /\b(?:cp|mv|rm|rmdir|mkdir|touch|install|truncate|ln)\s/,
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
// ── rm/mv/rmdir 的目标路径解析（best-effort）──
// 目的：让"文件被删除/移动"成为文件级记录。解析是启发式的——变量（$F）、
// glob（*.log）解析不了就跳过；相对路径按命令原样记录。所有由它产生的
// gone 标记在 UI 上都注明"由 shell 命令推断"，不冒充精确事实。
var REMOVAL_COMMANDS = /* @__PURE__ */ new Set(["rm", "rmdir", "mv"]);
// 按 && || ; 换行 和单 | 切段（顺序保证 || 先于 |），再逐段解析。
var COMMAND_SEGMENT_SPLIT = /&&|\|\||;|\n|\|/;
function tokenizeSegment(segment) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (const ch of segment) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current !== "") { tokens.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current !== "") tokens.push(current);
  return tokens;
}
function plausibleGonePath(token) {
  if (!looksLikePathToken(token)) return false;
  if (/[*?]/.test(token)) return false; // glob：不知道实际匹配了哪些文件
  if (token.startsWith("$")) return false; // 未解析的变量
  return true;
}
function parseShellRemovals(command) {
  const out = [];
  for (const segment of command.split(COMMAND_SEGMENT_SPLIT)) {
    // 先剥掉重定向子句，避免 `rm x > log` 把 log 当成被删路径
    const cleaned = segment.replace(/\s*\d*>>?\s*\S+/g, " ").replace(/\s*\d*<\s*\S+/g, " ");
    const tokens = tokenizeSegment(cleaned);
    if (tokens.length === 0 || !REMOVAL_COMMANDS.has(tokens[0])) continue;
    const args = [];
    let endOfFlags = false;
    for (let i = 1; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!endOfFlags && token === "--") { endOfFlags = true; continue; }
      if (!endOfFlags && token.startsWith("-") && token.length > 1) continue;
      args.push(token);
    }
    const paths = args.filter(plausibleGonePath);
    if (tokens[0] === "mv") {
      // mv src… dest：最后一个参数是目标。move-into-dir 时 to 只是近似值。
      if (paths.length < 2) continue;
      const dest = paths[paths.length - 1];
      for (const src of paths.slice(0, -1)) out.push({ path: src, kind: "rename", to: dest });
    } else {
      for (const path of paths) out.push({ path, kind: "delete" });
    }
  }
  return out;
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
// 注意这是白名单（路由只服务投影里出现过的路径）之外的**第二道**过滤，
// 覆盖凭据类目录与常见密钥文件名；黑名单天生不完备（token.txt 这类拦不住），
// 真正的边界是白名单。
var SENSITIVE_PATTERNS = [
  /(^|\/)\.[^/]*env[^/]*$/i,
  /(^|\/)\.env(\.[^/]*)?$/i,
  /(^|\/)[^/]*credential[^/]*$/i,
  /(^|\/)[^/]*secret[^/]*$/i,
  /(^|\/)[^/]*\.pem$/i,
  /(^|\/)[^/]*\.key$/i,
  /(^|\/)[^/]*\.p12$/i,
  /(^|\/)[^/]*\.pfx$/i,
  /(^|\/)[^/]*\.jks$/i,
  /(^|\/)[^/]*keystore[^/]*$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa|dsa)[^/]*$/i,
  /(^|\/)authorized_keys[^/]*$/i,
  /(^|\/)\.ssh\//,
  /(^|\/)\.aws\//,
  /(^|\/)\.gnupg\//,
  /(^|\/)\.kube\//,
  /(^|\/)\.docker\//,
  /(^|\/)\.kubeconfig$/i,
  /(^|\/)service-account[^/]*$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.pgpass$/i,
  /(^|\/)\.my\.cnf$/i
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
    // 未知工具的名字暂存（callId → {tool, turn}）：result 时若带 meta.diffs
    // 就泛化入账。独立于 pending，避免挤占 writer pending 的 256 上限。
    pendingUnknown: {},
    pendingShell: {},
    files: {},
    shells: [],
    totalEdits: 0,
    totalRefused: 0,
    shellWrites: 0,
    // 已结束的最大轮号。客户端靠它知道"这一轮结束了"，从而自动重取轮后快照
    // （全文对照的改后状态在 turn/end 才落定）。没有它，投影在轮次结束时
    // 不产生任何变化，客户端就永远停在轮次进行中拉到的那份缓存上。
    lastEndedTurn: -1
  };
}
function intent(toolName, args, turn) {
  const writer = WRITERS[toolName] !== void 0 ? WRITERS[toolName] : STRUCTURED_WRITERS[toolName];
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
  // 敏感路径在 pending 阶段就不携带全文：轮次中断时 pending 条目会残留到
  // projection cache 落盘，带全文等于把密钥写进磁盘缓存。敏感判定必须
  // 发生在入队时，而不是消费时。
  const sensitive = isSensitivePath(path);
  const fileText = parsed.file_text ?? parsed.content;
  const oldStr = parsed.old_str;
  const newStr = parsed.new_str;
  return {
    path,
    tool: toolName,
    kind: typeof fileText === "string" ? "create" : writer.kind,
    turn,
    ...(!sensitive && typeof oldStr === "string" ? { oldText: oldStr } : {}),
    ...(!sensitive && (typeof fileText === "string"
      ? { newText: fileText }
      : typeof newStr === "string" ? { newText: newStr } : {}))
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
// 单文件的记录上限：KEEP_TURNS 限的是轮次，不限记录总量——100 轮 × 每轮
// 多处编辑仍会让投影/view 无界膨胀（实测 12000 条记录时框架每个变更事件要
// 花 ~6ms 做 view+parse）。超限裁最旧的记录，计数同步扣减。
var MAX_EDITS_PER_FILE = 200;
var MAX_REFUSALS_PER_FILE = 50;
function prune(record) {
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length - PENDING_LIMIT; i += 1) delete record[keys[i]];
}
// 改动记录只保留最近 KEEP_TURNS 轮：编辑、被拒写入、shell 索引与计数一起裁剪，
// 更早的轮次整体删除。长会话的投影不再无界增长，检查点体积有上界；
// 轮次快照（apply2 里落盘的部分）用同一个常量，两边口径一致。
var KEEP_TURNS = 100;
function keptTurnSet(state) {
  const seen = {};
  for (const file of Object.values(state.files)) {
    for (const edit of file.edits) seen[edit.turn] = true;
    for (const refusal of file.refusals) seen[refusal.turn] = true;
    if (file.gone !== void 0) seen[file.gone.turn] = true;
  }
  for (const shell of state.shells) seen[shell.turn] = true;
  return Object.keys(seen).map(Number).sort((a, b) => b - a);
}
function pruneTurns(state) {
  const turns = keptTurnSet(state);
  let files = state.files;
  let totalEdits = state.totalEdits;
  let totalRefused = state.totalRefused;
  let shells = state.shells;
  let changed = false;
  if (turns.length > KEEP_TURNS) {
    // cutoff = 第 KEEP_TURNS 新的轮次；比它更早的一律删。
    const cutoff = turns[KEEP_TURNS - 1];
    const kept = {};
    totalEdits = 0;
    totalRefused = 0;
    for (const [path, file] of Object.entries(state.files)) {
      // 快路径：整个文件都在保留窗口内时引用原样复用，不做无谓拷贝。
      let touched = false;
      for (const edit of file.edits) if (edit.turn < cutoff) { touched = true; break; }
      if (!touched) for (const refusal of file.refusals) if (refusal.turn < cutoff) { touched = true; break; }
      if (!touched && file.gone !== void 0 && file.gone.turn < cutoff) touched = true; // 删除记录也老化
      if (!touched) {
        kept[path] = file;
        totalEdits += file.edits.length;
        totalRefused += file.refusals.length;
        continue;
      }
      const edits = file.edits.filter((edit) => edit.turn >= cutoff);
      const refusals = file.refusals.filter((refusal) => refusal.turn >= cutoff);
      const gone = file.gone !== void 0 && file.gone.turn >= cutoff ? file.gone : void 0;
      if (edits.length === 0 && refusals.length === 0 && gone === void 0) continue; // 整文件都被裁掉就整个移除
      kept[path] = { path: file.path, edits, refusals, sensitive: file.sensitive, ...(gone !== void 0 ? { gone } : {}) };
      totalEdits += edits.length;
      totalRefused += refusals.length;
    }
    shells = state.shells.some((shell) => shell.turn < cutoff)
      ? state.shells.filter((shell) => shell.turn >= cutoff)
      : state.shells;
    files = kept;
    changed = true;
  }
  // 单文件上限在这里同步执行一次：老检查点恢复（或上限调小）后，下一次
  // turn/end 就把全量收敛到上限内，不用等每个文件的下一次编辑。
  const keptFiles = {};
  for (const [path, original] of Object.entries(files)) {
    let file = original;
    if (file.edits.length > MAX_EDITS_PER_FILE || file.refusals.length > MAX_REFUSALS_PER_FILE) {
      const edits = file.edits.length > MAX_EDITS_PER_FILE ? file.edits.slice(-MAX_EDITS_PER_FILE) : file.edits;
      const refusals = file.refusals.length > MAX_REFUSALS_PER_FILE ? file.refusals.slice(-MAX_REFUSALS_PER_FILE) : file.refusals;
      totalEdits -= file.edits.length - edits.length;
      totalRefused -= file.refusals.length - refusals.length;
      file = { path: file.path, edits, refusals, sensitive: file.sensitive };
      changed = true;
    }
    if (file !== state.files[path]) changed = true;
    keptFiles[path] = file;
  }
  if (!changed) return state;
  // 计数跟着记录走：摘要显示的就是"现在还看得到的这些"，不数已删除的历史。
  let shellWrites = 0;
  for (const shell of shells) shellWrites += shell.repeat;
  return { ...state, files: keptFiles, shells, totalEdits, totalRefused, shellWrites };
}
function apply(state, event) {
  // 轮次结束：记下轮号。这一步让投影在 turn/end 时确实变化，客户端据此
  // 重取该轮的轮后快照——全文对照的"改后"状态就是在 turn/end 落定的。
  if (event.type === "turn/end") {
    const turn = event.data?.turn;
    if (typeof turn === "number" && turn > state.lastEndedTurn) {
      return pruneTurns({ ...state, lastEndedTurn: turn });
    }
    return state;
  }
  if (event.type === "tool/call") {
    const callData = event.data;
    if (SHELLS.has(callData.name)) {
      const command = commandOf(callData.arguments);
      if (command !== void 0 && looksLikeShellWrite(command)) {
        // 只留命令的哈希用于同轮去重；原文不进投影（可能带 inline 凭据）。
        // rm/mv/rmdir 额外解析出目标路径（best-effort），result 成功后落
        // file.gone 标记——让"文件被删/被移"成为文件级记录。
        const removals = parseShellRemovals(command);
        state.pendingShell[callData.callId] = {
          turn: callData.turn,
          tool: callData.name,
          hash: hashOf(command),
          ...(removals.length > 0 ? { removals } : {})
        };
        prune(state.pendingShell);
      }
      return state;
    }
    const pendingWrite = intent(callData.name, callData.arguments, callData.turn);
    if (pendingWrite !== void 0) {
      state.pending[callData.callId] = pendingWrite;
      prune(state.pending);
      return state;
    }
    // 未知工具：记下名字，result 时若按约定报告了 meta.diffs（工具自己声明
    // 的文件改动）就走泛化追踪——不枚举工具名，任何现在/将来的、第三方
    // 插件的 diff 报告工具自动被覆盖。独立 Map，避免挤占 writer pending。
    if (state.pendingUnknown[callData.callId] === void 0) {
      state.pendingUnknown[callData.callId] = { tool: callData.name, turn: callData.turn };
      prune(state.pendingUnknown);
    }
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
    // rm/mv 解析出的路径：命令成功才确认"文件消失"。
    if (Array.isArray(shell?.removals) && shell.removals.length > 0) {
      for (const removal of shell.removals) {
        if (removal === null || typeof removal.path !== "string" || removal.path === "") continue;
        const goneFile = fileOf(state, removal.path);
        goneFile.gone = {
          turn,
          kind: removal.kind === "rename" ? "rename" : "delete",
          callId,
          ...(removal.kind === "rename" && typeof removal.to === "string" ? { to: removal.to } : {})
        };
      }
    }
    // 同一轮里完全相同的命令合并计数，不再重复列一遍。
    const same = hash === "" ? void 0 : state.shells.find((s) => s.turn === turn && s.hash === hash);
    if (same !== void 0) {
      // 不可变更新：就地改 repeat 会让新旧 state 共享同一个对象，违反投影
      // 的值语义（旧快照的读者会看到对象在背后变）。
      const shells = state.shells.map((s) => (s === same ? { ...s, repeat: s.repeat + 1 } : s));
      return { ...state, shells, shellWrites: state.shellWrites + 1 };
    }
    // 索引化：命令原文不进投影，只留 callId，展示时按 callId 从会话日志取回。
    state.shells.push({
      turn,
      tool: typeof shell?.tool === "string" ? shell.tool : "bash",
      callId,
      hash,
      repeat: 1
    });
    if (state.shells.length > SHELL_LIMIT) {
      const removed = state.shells.splice(0, state.shells.length - SHELL_LIMIT);
      // 计数跟着记录走：被裁掉的 shell 不再可见，就不该被数。
      let dropped = 0;
      for (const entry of removed) dropped += entry.repeat;
      state.shellWrites -= dropped;
    }
    state.shellWrites += 1;
    return { ...state };
  }
  const write = Object.hasOwn(state.pending, callId) ? state.pending[callId] : void 0;
  if (write === void 0) {
    // ── 泛化追踪：未知工具按 meta.diffs 自报的改动入账 ──
    const unknown = Object.hasOwn(state.pendingUnknown, callId) ? state.pendingUnknown[callId] : void 0;
    delete state.pendingUnknown[callId];
    if (unknown === void 0 || data.error !== void 0) return state;
    const diffs = data.meta !== null && typeof data.meta === "object" && Array.isArray(data.meta.diffs) ? data.meta.diffs : void 0;
    if (diffs === void 0) return state;
    const toolName = typeof unknown.tool === "string" && unknown.tool !== "" ? unknown.tool : "unknown";
    const unknownTurn = typeof unknown.turn === "number" ? unknown.turn : -1;
    let recorded = false;
    for (const entry of diffs) {
      if (entry === null || typeof entry !== "object") continue;
      if (typeof entry.path !== "string" || entry.path === "") continue;
      const oldText = typeof entry.oldText === "string" ? entry.oldText : void 0;
      const newText = typeof entry.newText === "string" ? entry.newText : void 0;
      if (oldText === void 0 && newText === void 0) continue;
      const file = fileOf(state, entry.path);
      if (file.gone !== void 0) delete file.gone; // 写入成功 = 文件重新存在
      const sensitive = isSensitivePath(entry.path);
      const rec = {
        turn: unknownTurn,
        tool: toolName,
        kind: oldText === void 0 ? "create" : "edit",
        callId,
        source: "applied",
        ...numKey("oldStart", entry.oldStart),
        ...numKey("newStart", entry.newStart),
        ...(sensitive ? { sensitive: true } : {})
      };
      if (sensitive) file.sensitive = true;
      file.edits.push(rec);
      let droppedUnknown = 0;
      if (file.edits.length > MAX_EDITS_PER_FILE) {
        droppedUnknown = file.edits.splice(0, file.edits.length - MAX_EDITS_PER_FILE).length;
      }
      state.totalEdits += 1 - droppedUnknown;
      recorded = true;
    }
    return recorded ? { ...state } : state;
  }
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
    if (file.refusals.length > MAX_REFUSALS_PER_FILE) {
      file.refusals.splice(0, file.refusals.length - MAX_REFUSALS_PER_FILE);
    }
    state.totalRefused += 1;
    return { ...state };
  }
  // applied diff 只用来取起始行号与判定 kind；文本本身不进投影。
  const applied = appliedDiff(data.meta, write.path);
  const hasOldText = (applied !== void 0 && applied.oldText !== void 0) || write.oldText !== void 0;
  const kind = !hasOldText || write.oldText === "" ? write.kind : "edit";
  const sensitive = isSensitivePath(write.path);
  // 写入成功 = 文件重新存在：清掉可能存在的 gone 标记（rm 之后又 write 回来）。
  if (file.gone !== void 0) delete file.gone;
  // 该工具的写入既没有 applied diff、参数里也没有文本（如 univer 系列）：
  // 记 noText，客户端显示中性提示而不是去取一个不存在的文本对比。
  const hasText = applied !== void 0 || write.oldText !== void 0 || write.newText !== void 0;
  // 索引化：投影只存轻量索引，全量文本留在会话日志里，展示时按 callId 取回。
  // 行号只留起始行（客户端 diff 的绝对行号定位靠它），行数/字节大小客户端用不到。
  const rec = {
    turn: write.turn,
    tool: write.tool,
    kind,
    callId,
    source: applied === void 0 ? "arguments" : "applied",
    ...numKey("oldStart", applied?.oldStart),
    ...numKey("newStart", applied?.newStart),
    ...(hasText ? {} : { noText: true })
  };
  if (sensitive) {
    // 敏感文件：只记录"改过"，内容不进投影（避免缓存落盘泄漏）。
    file.sensitive = true;
    file.edits.push({ ...rec, sensitive: true });
  } else {
    file.edits.push(rec);
  }
  let droppedEdits = 0;
  if (file.edits.length > MAX_EDITS_PER_FILE) {
    droppedEdits = file.edits.splice(0, file.edits.length - MAX_EDITS_PER_FILE).length;
  }
  // 计数跟着记录走：被裁掉的编辑不再可见，就不该被数。
  state.totalEdits += 1 - droppedEdits;
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
  // `of`（共几次）不再由 view 携带——它恒等于该文件记录数，客户端用
  // full.edits.length 现算，省掉每条记录一个字段（12000 条时约省 300KB/次推送）。
  const files = Object.values(state.files)
    .filter((file) => file.edits.length > 0 || file.refusals.length > 0 || file.gone !== void 0)
    .sort((a, b) => lastTurn(b) - lastTurn(a))
    .map((file) => ({
      path: file.path,
      edits: file.edits.map((edit, index) => ({ ...edit, seq: index + 1 })).reverse(),
      refusals: file.refusals.slice().reverse(),
      sensitive: file.sensitive,
      ...(file.gone !== void 0 ? { gone: file.gone } : {})
    }));
  return {
    files,
    // shell 写入同样新→旧。
    shells: state.shells.slice().reverse(),
    totalEdits: state.totalEdits,
    totalRefused: state.totalRefused,
    shellWrites: state.shellWrites,
    lastEndedTurn: typeof state.lastEndedTurn === "number" ? state.lastEndedTurn : -1
  };
}
function lastTurn(file) {
  let last = -1;
  for (const edit of file.edits) if (edit.turn > last) last = edit.turn;
  for (const r of file.refusals) if (r.turn > last) last = r.turn;
  if (file.gone !== void 0 && file.gone.turn > last) last = file.gone.turn;
  return last;
}

var editSchema = z.object({
  turn: z.number(),
  tool: z.string(),
  kind: z.union([z.literal("edit"), z.literal("create")]),
  callId: z.string(),
  source: z.enum(["arguments", "applied"]),
  oldStart: z.number().optional(),
  newStart: z.number().optional(),
  sensitive: z.boolean().optional(),
  // 该工具的写入没有可用的文本对比（如 univer 系列无 applied diff、参数无文本）
  noText: z.boolean().optional(),
  // 这个文件的第几次修改（view 里编号，时间正序）；"共几次"由客户端用
  // full.edits.length 现算，不再随每条记录推送。
  seq: z.number()
});
var refusalSchema = z.object({
  turn: z.number(),
  tool: z.string(),
  reason: z.string()
});
// 文件消失标记（由 rm/mv/rmdir 的 shell 命令 best-effort 推断）
var goneSchema = z.object({
  turn: z.number(),
  kind: z.union([z.literal("delete"), z.literal("rename")]),
  callId: z.string(),
  to: z.string().optional()
});
var fileSchema = z.object({
  path: z.string(),
  edits: z.array(editSchema),
  refusals: z.array(refusalSchema),
  sensitive: z.boolean().optional(),
  gone: goneSchema.optional()
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
  shellWrites: z.number(),
  lastEndedTurn: z.number()
});
// 框架在每个"使状态变化的事件"上都会执行 wire.viewSchema.parse(wire.view(state))
// ——这是投影契约的固定成本。zod 深校验 12000 条记录实测 5.92ms/事件，而 view 是
// 本模块自己构造的纯函数输出，逐字段校验属于纯开销。注册一个 O(1) 的浅校验
// 顶住结构性错误，完整 zod schema 保留在 viewSchema 上（测试/离线校验用）。
var viewSchema = schema;
var fastSchema = {
  parse(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("whatChangedSidebar: view must be an object");
    }
    if (!Array.isArray(value.files) || !Array.isArray(value.shells)) {
      throw new Error("whatChangedSidebar: view.files/shells must be arrays");
    }
    if (typeof value.totalEdits !== "number" || typeof value.lastEndedTurn !== "number") {
      throw new Error("whatChangedSidebar: view counters must be numbers");
    }
    return value;
  }
};
// state 的浅校验：registry 从 projection cache 复原时用它 parse 落盘的
// state（不是 view）。val 由本插件自己的 checkpoint 写出且只有同版本才可用，
// 浅结构校验足够，还避免 zod 深校验在恢复路径剥字段/耗时。
var fastStateSchema = {
  parse(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("whatChangedSidebar: state must be an object");
    }
    if (value.files === null || typeof value.files !== "object" || Array.isArray(value.files)) {
      throw new Error("whatChangedSidebar: state.files must be a record");
    }
    if (!Array.isArray(value.shells)) {
      throw new Error("whatChangedSidebar: state.shells must be an array");
    }
    if (typeof value.totalEdits !== "number" || typeof value.lastEndedTurn !== "number") {
      throw new Error("whatChangedSidebar: state counters must be numbers");
    }
    return value;
  }
};
// ── 注册契约（DSH 0.1.1-rc.2 起的 session-projection 新格式）──
// register() 会把 def 擦除成 { key, stateSchema, init, apply, wire, stateVersion }，
// 顶层的 schema/view 直接被丢弃；snapshot()/drive() 遇到 wire 缺失的单元
// 整个跳过——旧格式注册的投影客户端永远收不到值（"一直加载改动记录中"）。
// wire.viewSchema 走浅校验（热路径），stateSchema 只在检查点恢复时调用。
// schema/view 仍挂在导出对象上供测试使用（register 会忽略多余字段）。
var whatChangedProjection = {
  key: "whatChangedSidebar",
  stateSchema: fastStateSchema,
  init,
  apply: (state, event) => apply(state, event),
  wire: { viewSchema: fastSchema, view },
  // v14: 未知工具泛化追踪（meta.diffs 自报改动即入账，独立 pendingUnknown）。
  // v13: rm/mv/rmdir 的文件级 gone 标记（删除/移动检测）、univer 系列工具
  //      进 STRUCTURED_WRITERS（noText 记录）、二进制文件不进快照。
  // v12: ①pending 阶段敏感路径不再携带全文；②单文件记录上限；③view 去 of。
  stateVersion: 14,
  schema: viewSchema,
  view
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
// 提取一个文件在会话里的全部编辑片段（时间正序），供客户端重建各轮的完整文件状态。
// 投影是纯索引不存文本，所以文本在这里从日志取：applied diff 优先，缺失回退 call 参数。
// 被拒绝的写入（结果带 error）没有生效，不进链。
function collectFileEdits(events, path) {
  const out = [];
  if (!Array.isArray(events)) return out;
  // 只缓存写入工具的调用事件：pending 的唯一用途是给 applied diff 缺失的
  // 写入回退取参数。全量缓存的话，一条长会话会把所有 bash 大参数都留在
  // 这次请求的内存里。
  const pending = {}; // callId → tool/call 事件（回退取参数用）
  for (const ev of events) {
    if (ev.type === "tool/call") {
      const d = ev.data;
      if (d !== void 0 && typeof d.callId === "string" && WRITERS[d.name] !== void 0) pending[d.callId] = d;
      continue;
    }
    if (ev.type !== "tool/result") continue;
    const data = ev.data;
    const callId = data?.message?.source?.callId;
    if (typeof callId !== "string") continue;
    const call = pending[callId];
    const write = call !== void 0 ? intent(call.name, call.arguments, call.turn) : void 0;
    const applied = appliedDiff(data?.meta, path);
    if (write !== void 0) {
      if (write.path !== path) continue;
    } else if (applied === void 0) {
      // 不是本插件认识的写入工具：只有带 applied diff 且路径匹配才算
      continue;
    }
    if (data.error !== void 0) continue; // 被拒的写入没有生效
    const oldText = applied !== void 0 && applied.oldText !== void 0 ? applied.oldText : write.oldText;
    const newText = applied !== void 0 && applied.newText !== void 0 ? applied.newText : write.newText;
    if (oldText === void 0 && newText === void 0) continue;
    out.push({
      callId,
      turn: typeof data?.turn === "number" ? data.turn : write.turn,
      time: typeof ev.time === "number" ? ev.time : 0,
      oldText,
      newText,
      ...(typeof applied?.newStart === "number" ? { newStart: applied.newStart } : {}),
      ...(typeof applied?.newLines === "number" ? { newLines: applied.newLines } : {}),
      ...(typeof applied?.oldStart === "number" ? { oldStart: applied.oldStart } : {}),
      ...(typeof applied?.oldLines === "number" ? { oldLines: applied.oldLines } : {})
    });
  }
  return out;
}

// ── 轮次快照的落盘持久化（version 2：内容去重） ──
// 快照按会话写成一份 JSON 文档，与投影同口径只保留最近 KEEP_TURNS 轮。
// 敏感路径在抓取入口就被拒之门外，构建文档时再滤一次，敏感内容绝不落盘。
// 文档结构（version 2）：
//   blobs:       sha1 → 内容字符串（去重存储：同一份文件内容只存一次，
//                相邻轮次内容未变时从 O(轮数) 降到 O(1)）
//   beforeByCall: callId → { t: 轮次, p: 路径, b: sha1|null }
//   afterByTurn:  轮次(字符串) → { 路径: sha1|null }
// version 1（c 直接存内容）在加载时原位迁移。
var SNAP_DOC_VERSION = 2;
var SNAP_DOC_MAX_BYTES = 12 * 1024 * 1024; // 单会话文档体积上限，超出删最老轮直到达标
function snapshotDirOf() {
  const home = typeof process !== "undefined" && process.env && process.env.DSH_HOME
    ? process.env.DSH_HOME
    : homedir() + "/.dsh";
  return home + "/storages/what-changed-sidebar";
}
function emptySnapDoc() {
  return { version: SNAP_DOC_VERSION, savedAt: 0, blobs: {}, beforeByCall: {}, afterByTurn: {} };
}
// v1 → v2 原位迁移：把所有内联内容搬进 blobs，换成 sha1 引用。
function migrateSnapDoc(doc) {
  if (doc.version === SNAP_DOC_VERSION) return doc;
  if (doc.version !== 1) return null;
  const migrated = { version: SNAP_DOC_VERSION, savedAt: doc.savedAt, blobs: {}, beforeByCall: {}, afterByTurn: {} };
  const blobOf = (content) => {
    if (typeof content !== "string") return null;
    const hash = createHash("sha1").update(content).digest("hex");
    if (migrated.blobs[hash] === void 0) migrated.blobs[hash] = content;
    return hash;
  };
  for (const [callId, entry] of Object.entries(doc.beforeByCall)) {
    migrated.beforeByCall[callId] = { t: entry.t, p: entry.p, b: blobOf(entry.c) };
  }
  for (const [turnKey, byPath] of Object.entries(doc.afterByTurn)) {
    const merged = {};
    for (const [path, content] of Object.entries(byPath)) merged[path] = blobOf(content);
    migrated.afterByTurn[turnKey] = merged;
  }
  return migrated;
}
function loadSnapDoc(sessionId) {
  try {
    const doc = JSON.parse(readFileSync(snapshotDirOf() + "/" + sessionId + ".json", "utf8"));
    if (doc === null || typeof doc !== "object") return null;
    const migrated = migrateSnapDoc(doc);
    if (migrated === null) return null;
    if (migrated.blobs === null || typeof migrated.blobs !== "object") return null;
    if (migrated.beforeByCall === null || typeof migrated.beforeByCall !== "object") return null;
    if (migrated.afterByTurn === null || typeof migrated.afterByTurn !== "object") return null;
    return migrated;
  } catch (e) {
    return null; // 不存在/损坏都当没有：快照缺失有逐次修改兜底
  }
}
// 文档里出现过的全部轮次（降序）。afterByTurn 的键与 beforeByCall 的 t 字段取并集。
function snapDocTurns(doc) {
  const seen = {};
  for (const turnKey of Object.keys(doc.afterByTurn)) seen[turnKey] = true;
  for (const entry of Object.values(doc.beforeByCall)) {
    if (entry !== null && typeof entry === "object" && typeof entry.t === "number") seen[String(entry.t)] = true;
  }
  return Object.keys(seen).map(Number).sort((a, b) => b - a);
}
// 裁到最近 KEEP_TURNS 轮，并回收不再被引用的 blob。
function pruneSnapDoc(doc) {
  const turns = snapDocTurns(doc);
  if (turns.length <= KEEP_TURNS) return doc;
  const keep = {};
  for (let i = 0; i < KEEP_TURNS; i += 1) keep[String(turns[i])] = true;
  const afterByTurn = {};
  for (const turnKey of Object.keys(doc.afterByTurn)) if (keep[turnKey]) afterByTurn[turnKey] = doc.afterByTurn[turnKey];
  const beforeByCall = {};
  for (const [callId, entry] of Object.entries(doc.beforeByCall)) {
    if (typeof entry?.t === "number" && keep[String(entry.t)]) beforeByCall[callId] = entry;
  }
  const pruned = { version: SNAP_DOC_VERSION, savedAt: doc.savedAt, blobs: doc.blobs, beforeByCall, afterByTurn };
  return gcSnapBlobs(pruned);
}
// 删除没有任何引用指向的 blob（轮次被裁后，其独占内容随之释放）。
function gcSnapBlobs(doc) {
  const referenced = {};
  for (const entry of Object.values(doc.beforeByCall)) {
    if (typeof entry?.b === "string") referenced[entry.b] = true;
  }
  for (const byPath of Object.values(doc.afterByTurn)) {
    for (const ref of Object.values(byPath)) if (typeof ref === "string") referenced[ref] = true;
  }
  const blobs = {};
  for (const [hash, content] of Object.entries(doc.blobs)) {
    if (referenced[hash]) blobs[hash] = content;
  }
  return { version: SNAP_DOC_VERSION, savedAt: doc.savedAt, blobs, beforeByCall: doc.beforeByCall, afterByTurn: doc.afterByTurn };
}
// 把内存热快照覆盖进文档（内存优先——它更新），返回裁剪后的新文档。
// 纯函数：不改内存 Map，便于单测。snapshots/roundAfter 允许只传单个会话的
// 子集（调用方可用会话索引避免全量扫描）。
function buildSnapDoc(sessionId, baseDoc, snapshots, roundAfter) {
  const doc = {
    version: SNAP_DOC_VERSION,
    savedAt: baseDoc.savedAt,
    blobs: { ...baseDoc.blobs },
    beforeByCall: { ...baseDoc.beforeByCall },
    afterByTurn: {}
  };
  for (const [turnKey, byPath] of Object.entries(baseDoc.afterByTurn)) {
    doc.afterByTurn[turnKey] = { ...byPath };
  }
  const blobOf = (content) => {
    if (typeof content !== "string") return null;
    const hash = createHash("sha1").update(content).digest("hex");
    if (doc.blobs[hash] === void 0) doc.blobs[hash] = content;
    return hash;
  };
  const prefix = sessionId + "\n";
  for (const [key, map] of roundAfter) {
    if (!key.startsWith(prefix)) continue;
    const path = key.slice(prefix.length);
    if (isSensitivePath(path)) continue;
    for (const [turn, content] of map) {
      const turnKey = String(turn);
      const merged = doc.afterByTurn[turnKey] !== void 0 ? doc.afterByTurn[turnKey] : {};
      merged[path] = blobOf(content);
      doc.afterByTurn[turnKey] = merged;
    }
  }
  for (const [key, map] of snapshots) {
    if (!key.startsWith(prefix)) continue;
    const path = key.slice(prefix.length);
    if (isSensitivePath(path)) continue;
    for (const [callId, entry] of map) {
      if (typeof entry?.t !== "number") continue;
      doc.beforeByCall[callId] = { t: entry.t, p: path, b: blobOf(entry.c) };
    }
  }
  return pruneSnapDoc(doc);
}
// 体积上限内序列化：超出就从最老轮开始删（含 blob 回收），循环必然终止。
// 同步执行并原地收敛 doc——调用方随后把 doc 与 json 一起交付，避免异步窗口
// 里文档被边写边读。返回最终 JSON 串。
function serializeSnapDocWithinCap(doc, maxBytes) {
  for (;;) {
    doc.savedAt = Date.now();
    const json = JSON.stringify(doc);
    if (json.length <= maxBytes) return json;
    const turns = snapDocTurns(doc);
    if (turns.length === 0) return json;
    const oldest = String(turns[turns.length - 1]);
    delete doc.afterByTurn[oldest];
    for (const [callId, entry] of Object.entries(doc.beforeByCall)) {
      if (String(entry?.t) === oldest) delete doc.beforeByCall[callId];
    }
    const referenced = {};
    for (const entry of Object.values(doc.beforeByCall)) {
      if (typeof entry?.b === "string") referenced[entry.b] = true;
    }
    for (const byPath of Object.values(doc.afterByTurn)) {
      for (const ref of Object.values(byPath)) if (typeof ref === "string") referenced[ref] = true;
    }
    const blobs = {};
    for (const [hash, content] of Object.entries(doc.blobs)) {
      if (referenced[hash]) blobs[hash] = content;
    }
    doc.blobs = blobs;
  }
}
// 落盘：异步写（不阻塞事件循环），文件 0600、目录 0700——快照含用户编辑过
// 的文件全文，权限对齐 DSH 自有存储的惯例。
async function writeSnapDocFile(sessionId, json) {
  const dir = snapshotDirOf();
  await fsMkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = dir + "/" + sessionId + ".tmp";
  await fsWriteFile(tmp, json, { mode: 0o600 });
  await fsRename(tmp, dir + "/" + sessionId + ".json");
}

function apply2(ctx) {
  //
  // dsh 0.1.1-rc.2 起投影注册契约改成 { stateSchema, wire: { viewSchema, view } }：
  // 顶层 view/schema 会被 register() 擦除忽略，wire 缺失的投影不进客户端快照，
  // 侧栏就永远停在"加载改动记录中…"。whatChangedProjection 已按新契约构造
  // （wire.viewSchema 为浅校验，stateSchema 只在检查点恢复时调用）。
  ctx.sessionProjections.register(whatChangedProjection);
  const webServer = ctx.webServer;
  const sessions = ctx.sessions;
  const persistence = ctx.sessionPersistence;

  // ── 轮次快照：改前（编辑工具调用时抓）+ 改后（turn/end 时落定） ──
  // tool/call 事件在工具执行前提交，这时读盘拿到的就是"改前"的完整文件；
  // turn/end 事件意味着本轮结束，把这轮碰过的文件逐个读盘存为"改后"。
  // 全文对照 = diff(本轮第一处编辑的改前快照, 本轮的改后快照)，跟 shell 写入
  // 和反向推链都无关——本轮期间 shell 改了什么，就如实包含在"改后"里。
  // 敏感文件永不存内容（抓取入口直接跳过）。
  const SNAPSHOTS = new Map();    // "sessionId\npath" → Map(callId → {c: 内容|null, t: 轮次})
  const ROUND_AFTER = new Map();  // "sessionId\npath" → Map(turn → 内容|null)
  const TURN_TOUCHED = new Map(); // sessionId → Map(turn → Set(path))
  // 快照文档的进程内副本：每个会话只在第一次被读到时从盘上加载一次，
  // 之后 turn/end 时把内存热数据覆盖进去再整体写回。
  const SNAPSHOT_DOCS = new Map();
  const SNAPSHOTS_LOADED = new Set();
  // 每会话的 key 索引：buildSnapDoc 只扫本会话的 key，不再全量遍历所有会话。
  const SESSION_KEYS = new Map(); // sessionId → Set("sid\npath")
  // 有界增长：这些 Map 的键是 会话×路径/会话，进程内没有会话关闭事件可挂钩，
  // 用总量上限兜底（超出按插入序淘汰最旧的）。上限给得很宽，正常使用到不了。
  var MAX_SNAP_KEYS = 2000;   // SNAPSHOTS/ROUND_AFTER 的 key 数（会话×路径）
  var MAX_SNAP_SESSIONS = 64; // SNAPSHOT_DOCS / SESSION_KEYS 的会话数
  const SNAP_PER_PATH = 20;
  const SNAP_MAX_BYTES = 512 * 1024;
  function ensureSnapDocLoaded(sessionId) {
    if (SNAPSHOTS_LOADED.has(sessionId)) return;
    SNAPSHOTS_LOADED.add(sessionId);
    const doc = loadSnapDoc(sessionId);
    if (doc !== null) SNAPSHOT_DOCS.set(sessionId, doc);
    while (SNAPSHOT_DOCS.size > MAX_SNAP_SESSIONS) {
      const oldest = SNAPSHOT_DOCS.keys().next();
      if (oldest.done === true) break;
      SNAPSHOT_DOCS.delete(oldest.value);
    }
    while (SNAPSHOTS_LOADED.size > MAX_SNAP_SESSIONS * 2) {
      const oldest = SNAPSHOTS_LOADED.values().next();
      if (oldest.done === true) break;
      SNAPSHOTS_LOADED.delete(oldest.value);
    }
  }
  // 每会话串行的异步落盘链：turn/end 频率低，不做定时防抖，只保证同一会话
  // 的多次 flush 按顺序写盘（不会新内容被旧内容覆盖）。
  const FLUSH_CHAINS = new Map();
  function flushWhatChangedSnapshots(sessionId) {
    ensureSnapDocLoaded(sessionId);
    const base = SNAPSHOT_DOCS.get(sessionId) !== void 0 ? SNAPSHOT_DOCS.get(sessionId) : emptySnapDoc();
    const keys = SESSION_KEYS.get(sessionId);
    const snapshots = keys === void 0 ? new Map() : new Map([...SNAPSHOTS].filter(([k]) => keys.has(k)));
    const roundAfter = keys === void 0 ? new Map() : new Map([...ROUND_AFTER].filter(([k]) => keys.has(k)));
    const doc = buildSnapDoc(sessionId, base, snapshots, roundAfter);
    SNAPSHOT_DOCS.set(sessionId, doc);
    const json = serializeSnapDocWithinCap(doc, SNAP_DOC_MAX_BYTES);
    const prev = FLUSH_CHAINS.get(sessionId) !== void 0 ? FLUSH_CHAINS.get(sessionId) : Promise.resolve();
    const next = prev.then(() => writeSnapDocFile(sessionId, json)).catch((e) => {
      // 持久化失败不影响主流程：大不了退回"重启即空"的老行为。
    });
    FLUSH_CHAINS.set(sessionId, next);
  }
  function trackKey(sessionId, key) {
    let set = SESSION_KEYS.get(sessionId);
    if (set === void 0) { set = new Set(); SESSION_KEYS.set(sessionId, set); }
    set.add(key);
    while (SESSION_KEYS.size > MAX_SNAP_SESSIONS) {
      const oldest = SESSION_KEYS.keys().next();
      if (oldest.done === true) break;
      SESSION_KEYS.delete(oldest.value);
    }
  }
  function boundSnapKeys() {
    while (SNAPSHOTS.size > MAX_SNAP_KEYS) {
      const oldest = SNAPSHOTS.keys().next();
      if (oldest.done === true) break;
      SNAPSHOTS.delete(oldest.value);
    }
    while (ROUND_AFTER.size > MAX_SNAP_KEYS) {
      const oldest = ROUND_AFTER.keys().next();
      if (oldest.done === true) break;
      ROUND_AFTER.delete(oldest.value);
    }
  }
  function snapshotOf(sessionId, key) {
    let map = SNAPSHOTS.get(key);
    if (map === void 0) {
      map = new Map();
      SNAPSHOTS.set(key, map);
      trackKey(sessionId, key);
      boundSnapKeys();
    }
    return map;
  }
  function readDiskCapped(path) {
    try {
      const st = statSync(path);
      if (st.size > SNAP_MAX_BYTES) return null;
      const buffer = readFileSync(path);
      // 二进制守卫：首 8KB 含 NUL 字节视为二进制文件——utf8 快照只会是乱码，
      // 将来按它回退更会写坏文件。二进制文件不进快照体系。
      const probe = buffer.length > 8192 ? buffer.subarray(0, 8192) : buffer;
      if (probe.includes(0)) return null;
      return buffer.toString("utf8");
    } catch (e) { /* 文件不存在等 */ }
    return null; // null = 当时文件不存在或超出大小上限
  }
  ctx.effect(() => ctx.on("session/event", (session, event) => {
    if (event.type === "turn/end") {
      // 本轮结束：这轮碰过的文件逐个读盘，落定为该轮的"改后"快照。
      const touchedMap = TURN_TOUCHED.get(session.id);
      if (touchedMap === void 0) return;
      for (const [turn, paths] of touchedMap) {
        for (const path of paths) {
          const key = session.id + "\n" + path;
          let afterMap = ROUND_AFTER.get(key);
          if (afterMap === void 0) {
            afterMap = new Map();
            ROUND_AFTER.set(key, afterMap);
            trackKey(session.id, key);
          }
          afterMap.set(turn, readDiskCapped(path));
          while (afterMap.size > SNAP_PER_PATH) {
            const oldest = afterMap.keys().next();
            if (oldest.done === true) break;
            afterMap.delete(oldest.value);
          }
        }
      }
      TURN_TOUCHED.delete(session.id);
      boundSnapKeys();
      // 本轮的改后快照已落定：连同这轮抓到的改前快照一起持久化（异步）。
      flushWhatChangedSnapshots(session.id);
      return;
    }
    if (event.type !== "tool/call") return;
    const d = event.data;
    const write = intent(d?.name, d?.arguments, d?.turn);
    if (write === void 0 || isSensitivePath(write.path)) return;
    const key = session.id + "\n" + write.path;
    const map = snapshotOf(session.id, key);
    if (map.has(d.callId)) return;
    // t 记下调用所在轮次：持久化文档按轮次裁剪时要用。
    map.set(d.callId, { c: readDiskCapped(write.path), t: typeof d.turn === "number" ? d.turn : -1 });
    while (map.size > SNAP_PER_PATH) {
      const oldest = map.keys().next();
      if (oldest.done === true) break;
      map.delete(oldest.value);
    }
    // 记录"本轮碰过哪些文件"，turn/end 时统一落定改后快照。
    let touched = TURN_TOUCHED.get(session.id);
    if (touched === void 0) { touched = new Map(); TURN_TOUCHED.set(session.id, touched); }
    let paths = touched.get(write.turn);
    if (paths === void 0) { paths = new Set(); touched.set(write.turn, paths); }
    paths.add(write.path);
  }), "dsh-what-changed-sidebar: snapshots");

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
  // 路径白名单：路由只服务"该会话的投影里真实出现过的路径"。这是任意文件
  // 读取问题的根治——file/edits/snapshots 类路由的 path 由请求方提供，没有
  // 白名单时它们就是任意文件读取原语（敏感黑名单天生不完备，拦不住
  // /etc/hosts、~/.ssh/config 这类）。
  // 白名单来源必须是 host 侧的 registry.snapshot(session)：客户端那套
  // `binding.session.projections.faceOf` 在 host 上不存在，第一版误用它导致
  // 所有请求被 fail-closed 打成 404（"改动记录全没了"）。
  // snapshot() 会把每个已注册投影都跑一遍 view+schema.parse，因此按
  // session.seq 缓存——同一日志位置只算一次，一轮里 N 个文件块并发打开只付一次。
  const PATHS_CACHE = new Map(); // sessionId → { seq, set }
  const PATHS_CACHE_LIMIT = 16;
  function editedPathsOf(sessionId) {
    try {
      const session = typeof sessions.get === "function" ? sessions.get(sessionId) : void 0;
      if (session === void 0 || session === null) return null;
      const seq = typeof session.seq === "number" ? session.seq : -1;
      const hit = PATHS_CACHE.get(sessionId);
      if (hit !== void 0 && hit.seq === seq) return hit.set;
      const registry = ctx.sessionProjections;
      if (registry === void 0 || typeof registry.snapshot !== "function") return null;
      const cut = registry.snapshot(session);
      const view = cut !== void 0 && cut.values !== void 0 ? cut.values[whatChangedProjection.key] : void 0;
      if (view === void 0 || view === null || !Array.isArray(view.files)) return null;
      const set = new Set();
      for (const file of view.files) {
        if (file !== null && typeof file === "object" && typeof file.path === "string") set.add(file.path);
      }
      PATHS_CACHE.delete(sessionId);
      PATHS_CACHE.set(sessionId, { seq, set });
      while (PATHS_CACHE.size > PATHS_CACHE_LIMIT) {
        const oldest = PATHS_CACHE.keys().next();
        if (oldest.done === true) break;
        PATHS_CACHE.delete(oldest.value);
      }
      return set;
    } catch (e) {
      return null;
    }
  }
  if (webServer !== void 0 && sessions !== void 0) {
    // webRuntime 是可选依赖：拿不到时按空 trustedHosts 处理（loopback 仍然放行）。
    const trustedHostsOf = () => {
      try {
        const runtime = ctx.get("webRuntime");
        return runtime !== void 0 && Array.isArray(runtime.trustedHosts) ? runtime.trustedHosts : [];
      } catch (e) {
        return [];
      }
    };
    const fence = (req) => isTrustedApiRequest(req, trustedHostsOf());
    // 整文件读取的 mtime 缓存：同一文件在多个轮次块里被反复打开时避免重复
    // 读盘。只缓存 ≤512KB 的文件，条目数有上限。
    const FILE_CACHE_LIMIT = 8;
    const FILE_CACHE_MAX_BYTES = 512 * 1024;
    const fileCache = new Map(); // path → {mtimeMs, content}
    function cachedFileContent(path) {
      let value;
      try {
        const st = statSync(path);
        if (!st.isFile()) return { exists: false };
        if (st.size > 1024 * 1024) return { exists: true, content: null, reason: "too-large", sizeBytes: st.size };
        const hit = fileCache.get(path);
        if (hit !== void 0 && hit.mtimeMs === st.mtimeMs) return { exists: true, content: hit.content, sizeBytes: st.size };
        const buffer = readFileSync(path);
        // 二进制守卫：与快照侧同规则，乱码文本不该进全文对照。
        const probe = buffer.length > 8192 ? buffer.subarray(0, 8192) : buffer;
        if (probe.includes(0)) return { exists: true, content: null, reason: "binary", sizeBytes: st.size };
        const content = buffer.toString("utf8");
        if (st.size <= FILE_CACHE_MAX_BYTES) {
          fileCache.delete(path);
          fileCache.set(path, { mtimeMs: st.mtimeMs, content });
          while (fileCache.size > FILE_CACHE_LIMIT) {
            const oldest = fileCache.keys().next();
            if (oldest.done === true) break;
            fileCache.delete(oldest.value);
          }
        }
        value = { exists: true, content, sizeBytes: st.size };
      } catch (e) {
        return { exists: false };
      }
      return value;
    }
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/api/what-changed/diff",
      handler: async (req, res) => {
        try {
          // fence 第一优先：Host 不属于本部署、或浏览器标记跨站，一律 403。
          if (!fence(req)) {
            writeJson(res, 403, { ok: false, error: "forbidden" });
            return;
          }
          if (req.method !== "POST") {
            writeJson(res, 405, { ok: false, error: "method not allowed" });
            return;
          }
          const body = await readJsonBody(req);
          if (body === null) {
            writeJson(res, 400, { ok: false, error: "invalid JSON body" });
            return;
          }
          const wantsCommand = body.kind === "command";
          const wantsEdits = body.kind === "edits";
          const wantsSnapshots = body.kind === "snapshots";
          const wantsWhole = body.kind === "whole";
          const wantsDiff = !wantsCommand && !wantsEdits && !wantsSnapshots && !wantsWhole;
          // command 按 callId 取一条 shell 命令原文，本身不针对某个文件，
          // 因此不带 path、也不过路径白名单（它的出口由命令级敏感判定把守）。
          // 其余 kind 都必须带 path；sessionId 一律必需（都要定位会话）。
          if (!wantsCommand && (typeof body.path !== "string" || body.path === "")) {
            writeJson(res, 400, { ok: false, error: "path is required" });
            return;
          }
          if (typeof body.sessionId !== "string" || body.sessionId === "") {
            writeJson(res, 400, { ok: false, error: "sessionId is required" });
            return;
          }
          // 只有按单条 callId 取回的 diff / command 需要 callId。
          if ((wantsDiff || wantsCommand) && (typeof body.callId !== "string" || body.callId === "")) {
            writeJson(res, 400, { ok: false, error: "callId is required" });
            return;
          }
          if (!wantsCommand) {
            // 白名单：path 必须真的出现在该会话的投影里。会话未加载 → 404。
            const allowed = editedPathsOf(body.sessionId);
            if (allowed === null) {
              writeJson(res, 404, { ok: false, error: "session not loaded" });
              return;
            }
            if (!allowed.has(body.path)) {
              writeJson(res, 403, { ok: false, error: "path not in session" });
              return;
            }
            // 敏感文件的内容永不经这条路由离开进程：白名单只保证"agent 改过它"，
            // 改过的密钥文件同样不能读。
            if (isSensitivePath(body.path)) {
              writeJson(res, 403, { ok: false, error: "sensitive path" });
              return;
            }
          }
          if (wantsSnapshots) {
            // 编辑前快照 + 各轮改后快照。冷数据来自落盘文档（重启后仍在），
            // 内存热数据后写入覆盖——它更新。blob 引用在出口解析成内容。
            ensureSnapDocLoaded(body.sessionId);
            const doc = SNAPSHOT_DOCS.get(body.sessionId);
            const blobs = doc !== void 0 ? doc.blobs : {};
            const snaps = {};
            if (doc !== void 0) {
              for (const [callId, entry] of Object.entries(doc.beforeByCall)) {
                if (entry?.p === body.path) snaps[callId] = typeof entry.b === "string" ? (blobs[entry.b] !== void 0 ? blobs[entry.b] : null) : null;
              }
            }
            const key = body.sessionId + "\n" + body.path;
            const map = SNAPSHOTS.get(key);
            if (map !== void 0) for (const [callId, entry] of map) snaps[callId] = entry.c;
            const roundAfter = {};
            if (doc !== void 0) {
              for (const [turnKey, byPath] of Object.entries(doc.afterByTurn)) {
                if (byPath !== null && typeof byPath === "object" && byPath[body.path] !== void 0) {
                  const ref = byPath[body.path];
                  roundAfter[turnKey] = typeof ref === "string" ? (blobs[ref] !== void 0 ? blobs[ref] : null) : null;
                }
              }
            }
            const afterMap = ROUND_AFTER.get(key);
            if (afterMap !== void 0) for (const [turn, content] of afterMap) roundAfter[String(turn)] = content;
            writeJson(res, 200, { ok: true, value: { snapshots: snaps, roundAfter: roundAfter } });
            return;
          }
          const events = await eventsOf(body.sessionId);
          if (events === void 0) {
            writeJson(res, 404, { ok: false, error: "session log unavailable" });
            return;
          }
          if (wantsWhole) {
            // 全文对照的一次性原料：磁盘当前内容 + 快照 + 片段史，一个请求全带回。
            // 客户端不再需要 file/edits/snapshots 三个请求各发一遍。
            const fileValue = cachedFileContent(body.path);
            const doc = (ensureSnapDocLoaded(body.sessionId), SNAPSHOT_DOCS.get(body.sessionId));
            const blobs = doc !== void 0 ? doc.blobs : {};
            const snaps = {};
            if (doc !== void 0) {
              for (const [callId, entry] of Object.entries(doc.beforeByCall)) {
                if (entry?.p === body.path) snaps[callId] = typeof entry.b === "string" ? (blobs[entry.b] !== void 0 ? blobs[entry.b] : null) : null;
              }
            }
            const key = body.sessionId + "\n" + body.path;
            const map = SNAPSHOTS.get(key);
            if (map !== void 0) for (const [callId, entry] of map) snaps[callId] = entry.c;
            const roundAfter = {};
            if (doc !== void 0) {
              for (const [turnKey, byPath] of Object.entries(doc.afterByTurn)) {
                if (byPath !== null && typeof byPath === "object" && byPath[body.path] !== void 0) {
                  const ref = byPath[body.path];
                  roundAfter[turnKey] = typeof ref === "string" ? (blobs[ref] !== void 0 ? blobs[ref] : null) : null;
                }
              }
            }
            const afterMap = ROUND_AFTER.get(key);
            if (afterMap !== void 0) for (const [turn, content] of afterMap) roundAfter[String(turn)] = content;
            writeJson(res, 200, {
              ok: true,
              value: { file: fileValue, snapshots: snaps, roundAfter: roundAfter, edits: collectFileEdits(events, body.path) }
            });
            return;
          }
          if (wantsEdits) {
            // 该文件的完整片段历史（时间正序）：客户端重建各轮整文件状态的原料。
            writeJson(res, 200, { ok: true, value: { edits: collectFileEdits(events, body.path) } });
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
  viewSchema,
  whatChangedProjection
};
