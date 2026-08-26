window.__ModuleLoader__.load({
  id: "dsh-what-changed-sidebar",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var react = require("react");
    var useSyncExternalStore = react.useSyncExternalStore;
    var useCallback = react.useCallback;
    var useState = react.useState;
    var useMemo = react.useMemo;
    var useEffect = react.useEffect;
    var useRef = react.useRef;
    var createElement = react.createElement;

    var KEY = "whatChangedSidebar";

    // ── i18n（轻量：读 locale 服务选语言） ──
    var I18N = {
      zh: {
        loading: "加载改动记录中…",
        empty: "这个会话里 Agent 还没有写过任何文件。",
        summary: "{files} 个文件 · {edits} 处编辑",
        refusedSummary: " · {n} 处被拒",
        shellSummary: " · {n} 条 shell 写入",
        turn: "第 {n} 轮",
        edits: "{n} 处改动",
        refused: "{n} 处被拒",
        refusedHead: "被拒绝的写入",
        created: "新建",
        absRange: "第 {start}-{end} 行",
        relRange: "块内 {start}-{end} 行（相对）",
        foldSame: "已折叠 {n} 行未变",
        hideUnchanged: "收起未变行",
        noChanges: "文本无变化",
        sensitive: "敏感文件，内容已隐藏",
        collapse: "收起",
        openInEditor: "在编辑器中打开",
        copy: "复制",
        copied: "已复制",
        loadFailed: "内容加载失败（会话可能已关闭）",
        autoOpenLabel: "有文件改动时自动打开",
        autoOpenDesc: "Agent 修改文件后自动弹出改动记录",
        tabTitle: "改动记录",
        toolEdit: "编辑 edit",
        toolWrite: "写入 write",
        toolEditor: "编辑器 str_replace_editor",
        toolShell: "shell 命令",
        toolUnknown: "未知工具",
        nthEdit: "第 {seq}/{of} 次修改",
        latestEdit: "最新",
        shellHead: "shell 写入（{n} 条）",
        shellRedacted: "命令涉及敏感文件，原文已隐藏",
        shellRepeat: "×{n}",
        shellHint: "这些命令看起来写了文件，但 shell 结果不带文件信息，所以只列命令原文。",
        expandCommand: "展开完整命令",
        turnNet: "本轮改动",
        wholeView: "全文对照",
        perEdits: "逐次修改",
        wholeOngoing: "本轮进行中…",
        wholeOngoingHint: "全文对照在本轮结束后生成",
        truncated: "⋯（已截断，其余 {n} 行未显示）",
      },
      en: {
        loading: "Loading change log…",
        empty: "The agent has not written any file in this session.",
        summary: "{files} files · {edits} edits",
        refusedSummary: " · {n} refused",
        shellSummary: " · {n} shell writes",
        turn: "Turn {n}",
        edits: "{n} changes",
        refused: "{n} refused",
        refusedHead: "Refused writes",
        created: "Created",
        absRange: "lines {start}-{end}",
        relRange: "block lines {start}-{end} (relative)",
        foldSame: "{n} unchanged lines folded",
        hideUnchanged: "Hide unchanged lines",
        noChanges: "No textual changes",
        sensitive: "Sensitive file, content hidden",
        collapse: "Collapse",
        openInEditor: "Open in editor",
        copy: "Copy",
        copied: "Copied",
        loadFailed: "Failed to load content (session may be closed)",
        autoOpenLabel: "Auto-open on file changes",
        autoOpenDesc: "Open the change log automatically when the agent edits files",
        tabTitle: "Changes",
        toolEdit: "edit",
        toolWrite: "write",
        toolEditor: "str_replace_editor",
        toolShell: "shell command",
        toolUnknown: "unknown tool",
        nthEdit: "edit {seq} of {of}",
        latestEdit: "latest",
        shellHead: "Shell writes ({n})",
        shellRedacted: "Command touches a sensitive file; text hidden",
        shellRepeat: "×{n}",
        shellHint: "These commands look like they wrote files, but a shell result carries no file information, so only the command text is listed.",
        expandCommand: "Show full command",
        turnNet: "this round",
        wholeView: "Whole file",
        perEdits: "Per-edit changes",
        wholeOngoing: "Round in progress…",
        wholeOngoingHint: "The whole-file view is generated when this round ends",
        truncated: "… (truncated, {n} more lines not shown)",
      }
    };

    // 渲染层拿到的 ctx 是 better-sidebar 的注入上下文，不一定声明了本插件依赖的服务；
    // 一律先走可选读 ctx.get，读不到再退回属性访问。
    function serviceOf(ctx, name) {
      if (ctx === void 0 || ctx === null) return void 0;
      try {
        if (typeof ctx.get === "function") {
          var viaGet = ctx.get(name);
          if (viaGet !== void 0) return viaGet;
        }
      } catch (e) { /* undeclared service */ }
      try {
        return ctx[name];
      } catch (e) {
        return void 0;
      }
    }

    function langOf(ctx) {
      try {
        var locale = serviceOf(ctx, "locale");
        var active = locale && typeof locale.getSnapshot === "function" ? locale.getSnapshot().active : void 0;
        return active === "en" ? "en" : "zh";
      } catch {
        return "zh";
      }
    }
    function t(ctx, key, vars) {
      var lang = langOf(ctx);
      var dict = I18N[lang] || I18N.zh;
      var str = dict[key] || I18N.zh[key] || key;
      if (vars) for (var k in vars) str = str.replace("{" + k + "}", String(vars[k]));
      return str;
    }

    // ── 从当前会话的投影 store 拿订阅 face ──
    function faceOf(ctx, sessionId) {
      if (ctx === void 0 || sessionId === void 0) return void 0;
      var sessions = serviceOf(ctx, "sessions");
      if (sessions === void 0 || typeof sessions.binding !== "function") return void 0;
      var binding = sessions.binding(sessionId);
      if (binding === void 0 || binding.session === void 0) return void 0;
      var projections = binding.session.projections;
      if (projections === void 0 || typeof projections.faceOf !== "function") return void 0;
      return projections.faceOf(KEY);
    }

    // ── 按轮次分组：edits / refusals / shell 写入都按 turn 聚合，turn 降序 ──
    // 每个 turn 内部的顺序保持 view() 给的（已是新→旧），不再重排。
    function groupByTurn(files, shells) {
      var map = new Map();
      function ensureTurn(turn) {
        if (!map.has(turn)) map.set(turn, { turn: turn, files: new Map(), shells: [] });
        return map.get(turn);
      }
      function ensureFile(tg, path, sensitive) {
        if (!tg.files.has(path)) tg.files.set(path, { path: path, edits: [], refusals: [], sensitive: sensitive });
        var f = tg.files.get(path);
        if (sensitive) f.sensitive = true; // 任一编辑敏感，整文件按敏感对待
        return f;
      }
      (files || []).forEach(function (file) {
        (file.edits || []).forEach(function (edit) {
          ensureFile(ensureTurn(edit.turn), file.path, file.sensitive === true).edits.push(edit);
        });
        (file.refusals || []).forEach(function (r) {
          ensureFile(ensureTurn(r.turn), file.path, file.sensitive === true).refusals.push(r);
        });
      });
      (shells || []).forEach(function (s) {
        ensureTurn(s.turn).shells.push(s);
      });
      return Array.from(map.values())
        .sort(function (a, b) { return b.turn - a.turn; })
        .map(function (tg) {
          return { turn: tg.turn, files: Array.from(tg.files.values()), shells: tg.shells };
        });
    }

    // ── 路径尾名（editor tab 标题） ──
    function baseNameOf(path) {
      var p = String(path === void 0 ? "" : path);
      var at = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
      return at === -1 ? p : p.slice(at + 1) || p;
    }

    // ── 工具名友好化 ──
    function toolLabel(ctx, tool) {
      if (tool === "edit") return t(ctx, "toolEdit");
      if (tool === "write") return t(ctx, "toolWrite");
      if (tool === "str_replace_editor") return t(ctx, "toolEditor");
      if (tool === "bash" || tool === "shell" || tool === "sh") return t(ctx, "toolShell");
      return tool || t(ctx, "toolUnknown");
    }

    // ── 复制反馈：成功后"已复制"闪 1.5s，卸载时清定时器 ──
    function useCopyFlash() {
      var state = useState(false);
      var copied = state[0];
      var setCopied = state[1];
      var timerRef = useRef(0);
      useEffect(function () {
        return function () { if (timerRef.current !== 0) clearTimeout(timerRef.current); };
      }, []);
      var flash = function () {
        setCopied(true);
        if (timerRef.current !== 0) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(function () {
          timerRef.current = 0;
          setCopied(false);
        }, 1500);
      };
      return [copied, flash];
    }

    // ── 剪贴板：优先 async API，失败降级 execCommand ──
    function copyToClipboard(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return false; });
        }
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        return Promise.resolve(ok);
      } catch (e) { return Promise.resolve(false); }
    }

    // ── 行级 diff：前缀/后缀裁剪 + 有界 DP + 锚点分段（patience 思路） ──
    // 返回 [{t:"="|"-",o:旧行号,text}] / [{t:"+",n:新行号,text}]。
    // oldStart/newStart 是片段在文件里的绝对起始行号：给了就编绝对行号，
    // 没给退回块内相对行号（1 起）——调用方据此决定头部标注。
    // 注意 "" 是空文件（0 行），不是一行空行；"\n" 才是一行空行。
    var DP_LIMIT = 300;
    var MAX_DIFF_ROWS = 6000; // 渲染保护：超大 diff 截断，避免上万个 DOM 节点卡死侧边栏

    // 行输出上下文：emitMid/lcsMid 是模块级函数，行号基址与目标数组显式传递。
    function pushSame(out, oK, nK, text) { out.rows.push({ t: "=", o: out.oBase + oK, n: out.nBase + nK, text: text }); }
    function pushDel(out, k, text) { out.rows.push({ t: "-", o: out.oBase + k, n: void 0, text: text }); }
    function pushAdd(out, k, text) { out.rows.push({ t: "+", o: void 0, n: out.nBase + k, text: text }); }

    function diffRows(oldText, newText, oldStart, newStart) {
      var oldLines = oldText === void 0 || oldText === "" ? [] : String(oldText).split("\n");
      var newLines = newText === void 0 || newText === "" ? [] : String(newText).split("\n");
      // 末尾的 "" 只代表"文件以换行符结尾"，不是一行空行；留着会对
      // "补了结尾换行"这类改动渲染出假的一行 +空。
      if (oldLines.length > 0 && oldLines[oldLines.length - 1] === "") oldLines.pop();
      if (newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();
      var out = {
        rows: [],
        oBase: typeof oldStart === "number" && oldStart >= 1 ? oldStart : 1,
        nBase: typeof newStart === "number" && newStart >= 1 ? newStart : 1
      };

      var pre = 0;
      while (pre < oldLines.length && pre < newLines.length && oldLines[pre] === newLines[pre]) pre += 1;
      var suf = 0;
      while (
        suf < oldLines.length - pre && suf < newLines.length - pre &&
        oldLines[oldLines.length - 1 - suf] === newLines[newLines.length - 1 - suf]
      ) suf += 1;

      var i;
      for (i = 0; i < pre; i += 1) pushSame(out, i, i, oldLines[i]);

      emitMid(out, oldLines.slice(pre, oldLines.length - suf), newLines.slice(pre, newLines.length - suf), pre);

      var baseOld = oldLines.length - suf;
      var baseNew = newLines.length - suf;
      for (i = 0; i < suf; i += 1) pushSame(out, baseOld + i, baseNew + i, oldLines[baseOld + i]);
      // 渲染保护：行数超限时从尾部截断。哨兵行不带文案（diffRows 保持纯函数
      // 不碰 i18n），由 DiffRowsComponent 按当前语言渲染。
      if (out.rows.length > MAX_DIFF_ROWS) {
        var hidden = out.rows.length - MAX_DIFF_ROWS;
        out.rows.length = MAX_DIFF_ROWS;
        out.rows.push({ t: "=", o: void 0, n: void 0, text: "…", truncatedRows: hidden });
      }
      return out.rows;
    }

    // 中段 diff：≤DP_LIMIT 走 LCS DP；超出则找"两侧都唯一出现"的公共行当锚点
    // 分段递归——全文对照传入的是整个文件，锚点几乎总是存在，分段后每段都
    // 落回 DP；一个锚点都没有（整段重写）才退化成整段 −/+。
    function emitMid(out, oMid, nMid, offset) {
      if (oMid.length === 0 && nMid.length === 0) return;
      if (oMid.length === 0) {
        nMid.forEach(function (line, k) { pushAdd(out, offset + k, line); });
        return;
      }
      if (nMid.length === 0) {
        oMid.forEach(function (line, k) { pushDel(out, offset + k, line); });
        return;
      }
      if (oMid.length <= DP_LIMIT && nMid.length <= DP_LIMIT) {
        lcsMid(out, oMid, nMid, offset);
        return;
      }
      var anchors = uniqueCommonAnchors(oMid, nMid);
      if (anchors.length === 0) {
        // 无锚点（整段重写）：宁可粗也不假。
        oMid.forEach(function (line, k) { pushDel(out, offset + k, line); });
        nMid.forEach(function (line, k) { pushAdd(out, offset + k, line); });
        return;
      }
      var oPrev = 0, nPrev = 0;
      for (var a = 0; a < anchors.length; a += 1) {
        emitMid(out, oMid.slice(oPrev, anchors[a].o), nMid.slice(nPrev, anchors[a].n), offset + oPrev);
        pushSame(out, offset + anchors[a].o, offset + anchors[a].n, oMid[anchors[a].o]);
        oPrev = anchors[a].o + 1;
        nPrev = anchors[a].n + 1;
      }
      emitMid(out, oMid.slice(oPrev), nMid.slice(nPrev), offset + oPrev);
    }

    // 两侧都恰好出现一次的公共行，按出现顺序取（贪心保序，非最优 LIS，
    // 但对"大文件局部改动"场景足够好）。空行出现次数多，天然当不上锚点。
    function uniqueCommonAnchors(oMid, nMid) {
      var oCount = {}, nCount = {}, nPos = {}, i;
      for (i = 0; i < oMid.length; i += 1) oCount[oMid[i]] = (oCount[oMid[i]] || 0) + 1;
      for (i = 0; i < nMid.length; i += 1) nCount[nMid[i]] = (nCount[nMid[i]] || 0) + 1;
      for (i = 0; i < nMid.length; i += 1) {
        if (nMid[i] !== "" && nCount[nMid[i]] === 1 && oCount[nMid[i]] === 1 && nPos[nMid[i]] === void 0) nPos[nMid[i]] = i;
      }
      var anchors = [];
      var lastN = -1;
      for (i = 0; i < oMid.length; i += 1) {
        var line = oMid[i];
        if (line === "" || oCount[line] !== 1 || nCount[line] !== 1) continue;
        var nIdx = nPos[line];
        if (nIdx === void 0 || nIdx <= lastN) continue; // 保序：n 侧索引必须递增
        anchors.push({ o: i, n: nIdx });
        lastN = nIdx;
      }
      return anchors;
    }

    // 经典 LCS DP（有界）：301×301 ≈ 9 万格，Uint32Array 一块连续内存。
    function lcsMid(out, oMid, nMid, offset) {
      var m = oMid.length, n = nMid.length, W = n + 1;
      var dp = new Uint32Array((m + 1) * W);
      var a, b;
      for (a = m - 1; a >= 0; a -= 1) {
        for (b = n - 1; b >= 0; b -= 1) {
          dp[a * W + b] = oMid[a] === nMid[b]
            ? dp[(a + 1) * W + b + 1] + 1
            : Math.max(dp[(a + 1) * W + b], dp[a * W + b + 1]);
        }
      }
      var x = 0, y = 0;
      while (x < m && y < n) {
        if (oMid[x] === nMid[y]) { pushSame(out, offset + x, offset + y, oMid[x]); x += 1; y += 1; }
        else if (dp[(x + 1) * W + y] >= dp[x * W + y + 1]) { pushDel(out, offset + x, oMid[x]); x += 1; }
        else { pushAdd(out, offset + y, nMid[y]); y += 1; }
      }
      while (x < m) { pushDel(out, offset + x, oMid[x]); x += 1; }
      while (y < n) { pushAdd(out, offset + y, nMid[y]); y += 1; }
    }

    var DIFF_CONTEXT = 3;

    // ── diff 行渲染：±3 上下文 + 未变区折叠（DiffBlock / 整文件视图共用） ──
    function DiffRowsComponent(props) {
      var rows = props.rows;
      var ctx = props.ctx;
      // 每个折叠段独立的展开状态。
      var openSegs = useState({});
      var opens = openSegs[0];
      var setOpens = openSegs[1];

      var view = useMemo(function () {
        var changed = rows.map(function (r) { return r.t !== "="; });
        if (!changed.some(Boolean)) return { none: true };
        var keep = rows.map(function (_, i) {
          if (changed[i]) return true;
          var lo = Math.max(0, i - DIFF_CONTEXT);
          var hi = Math.min(rows.length - 1, i + DIFF_CONTEXT);
          for (var k = lo; k <= hi; k += 1) if (changed[k]) return true;
          return false;
        });
        var segs = [];
        var cur = null;
        rows.forEach(function (r, i) {
          if (keep[i]) {
            if (cur === null || cur.fold) { cur = { fold: false, rows: [] }; segs.push(cur); }
            cur.rows.push(r);
          } else {
            if (cur === null || !cur.fold) { cur = { fold: true, rows: [], count: 0 }; segs.push(cur); }
            cur.rows.push(r);
            cur.count += 1;
          }
        });
        return { none: false, segs: segs };
      }, [rows]);

      if (view.none) {
        return createElement("div", { className: "wc-dempty" }, t(ctx, "noChanges"));
      }

      var body = [];
      view.segs.forEach(function (seg, si) {
        if (!seg.fold) {
          seg.rows.forEach(function (r, ri) {
            // 截断哨兵行：diffRows 不碰 i18n，文案在这里按当前语言渲染。
            var text = r.truncatedRows !== void 0
              ? t(ctx, "truncated", { n: r.truncatedRows })
              : (r.text === "" ? "\u00A0" : r.text);
            body.push(createElement("div", {
              className: "wc-drow" + (r.t === "+" ? " wc-dadd" : r.t === "-" ? " wc-ddel" : ""),
              key: si + ":" + ri
            },
              createElement("span", { className: "wc-dno" }, r.o === void 0 ? "" : String(r.o)),
              createElement("span", { className: "wc-dno" }, r.n === void 0 ? "" : String(r.n)),
              createElement("span", { className: "wc-dsgn" }, r.t === "+" ? "+" : r.t === "-" ? "\u2212" : ""),
              createElement("span", { className: "wc-dtx" }, text)
            ));
          });
          return;
        }
        if (opens[si] === true) {
          seg.rows.forEach(function (r, ri) {
            body.push(createElement("div", { className: "wc-drow", key: si + ":" + ri },
              createElement("span", { className: "wc-dno" }, r.o === void 0 ? "" : String(r.o)),
              createElement("span", { className: "wc-dno" }, r.n === void 0 ? "" : String(r.n)),
              createElement("span", { className: "wc-dsgn" }),
              createElement("span", { className: "wc-dtx" }, r.text === "" ? "\u00A0" : r.text)
            ));
          });
          body.push(createElement("button", {
            type: "button", className: "wc-dgap", key: "f" + si,
            onClick: function () { setOpens(function (prev) { var next = Object.assign({}, prev); next[si] = false; return next; }); }
          }, "\u25B4 " + t(ctx, "hideUnchanged")));
        } else {
          body.push(createElement("button", {
            type: "button", className: "wc-dgap", key: "f" + si,
            onClick: function () { setOpens(function (prev) { var next = Object.assign({}, prev); next[si] = true; return next; }); }
          }, "\u22EF " + t(ctx, "foldSame", { n: seg.count }) + " \u22EF"));
        }
      });

      return createElement("div", { className: "wc-dcode" }, body);
    }

    // ── 内联对比块：单流 −红 +绿，头部一行轻标注 + 复制 ──
    function DiffBlock(props) {
      var ctx = props.ctx;
      var edit = props.edit;
      var content = props.content;
      var onCopy = props.onCopy;

      var copyFlash = useCopyFlash();
      var copied = copyFlash[0];
      var flashCopied = copyFlash[1];

      var built = useMemo(function () {
        // 绝对行号：applied diff 带片段在文件里的起始行号，行号槽直接编文件的行。
        return diffRows(content.oldText, content.newText, edit.oldStart, edit.newStart);
      }, [content.oldText, content.newText, edit.oldStart, edit.newStart]);

      var anyChange = built.some(function (r) { return r.t !== "="; });
      if (!anyChange) {
        return createElement("div", { className: "wc-diff" },
          createElement("div", { className: "wc-dempty" }, t(ctx, "noChanges"))
        );
      }

      // 头部：优先新文件侧的行号区间；纯删除退回旧文件侧。
      // 只有 applied diff 没给起始行号时才是相对行号（块内 1 起）。
      var firstN = null, lastN = null, hasN = false;
      var firstO = null, lastO = null, hasO = false;
      built.forEach(function (r) {
        if (r.n !== void 0) { hasN = true; if (firstN === null) firstN = r.n; lastN = r.n; }
        if (r.o !== void 0) { hasO = true; if (firstO === null) firstO = r.o; lastO = r.o; }
      });
      var useNew = hasN && (edit.newStart !== void 0 || edit.oldStart === void 0);
      var startNo = (useNew ? firstN : firstO) || 1;
      var endNo = (useNew ? lastN : lastO) || 1;
      // 新建（create）没有 applied diff 行号，但新文件的行本来就是从 1 开始的
      // 绝对行号，标"块内相对"反而让人看不懂。
      var relative = edit.kind === "create"
        ? false
        : (useNew ? edit.newStart === void 0 : edit.oldStart === void 0);
      var addCount = 0, remCount = 0;
      built.forEach(function (r) {
        if (r.t === "+") addCount += 1;
        if (r.t === "-") remCount += 1;
      });
      var rangeText = (relative
        ? t(ctx, "relRange", { start: startNo, end: endNo })
        : t(ctx, "absRange", { start: startNo, end: endNo }))
        + " · +" + addCount + " −" + remCount;

      var copyText = built.map(function (r) {
        return (r.t === "+" ? "+ " : r.t === "-" ? "- " : "  ") + r.text;
      }).join("\n");

      return createElement("div", { className: "wc-diff" },
        createElement("div", { className: "wc-diffTop" },
          createElement("span", { className: "wc-diffRange" }, rangeText),
          createElement("button", {
            type: "button",
            className: "wc-copyBtn",
            title: t(ctx, "copy"),
            onClick: function (e) {
              e.stopPropagation();
              var p = onCopy(copyText);
              if (p && typeof p.then === "function") p.then(function (ok) { if (ok) flashCopied(); });
              else flashCopied();
            }
          }, copied ? t(ctx, "copied") : t(ctx, "copy"))
        ),
        createElement(DiffRowsComponent, { rows: built, ctx: ctx })
      );
    }

    // ── 单处编辑：工具标签 + 懒加载内容 ──
    // 索引化后投影只给 callId，内容按需从 host RPC 取。
    function EditBlocks(props) {
      var edit = props.edit;
      var ctx = props.ctx;
      var onCopy = props.onCopy;
      var ofCount = props.ofCount;

      var blocks = [];
      // 只改过一次的文件不显示编号：本来就只有一块，"唯一一次修改"是纯噪音。
      // 一轮里改了多次才需要"第几次"这个坐标。
      var numbered = ofCount > 1;
      blocks.push(
        createElement("div", { className: "wc-editMeta", key: "meta" },
          numbered && createElement("span", { className: "wc-seqTag" }, t(ctx, "nthEdit", { seq: edit.seq, of: ofCount })),
          numbered && edit.seq === ofCount && createElement("span", { className: "wc-latestTag" }, t(ctx, "latestEdit")),
          createElement("span", { className: "wc-toolTag" }, toolLabel(ctx, edit.tool)),
          edit.kind === "create" && createElement("span", { className: "wc-kindTag" }, t(ctx, "created"))
        )
      );

      if (edit.sensitive) {
        blocks.push(createElement("div", { className: "wc-sensitive", key: "sens" },
          "🔒 " + t(ctx, "sensitive")
        ));
        return createElement("div", { className: "wc-edit" }, blocks);
      }

      // 懒加载内容：只在展开时 fetch。EditBlocks 本身是纯渲染，内容由父级（ExpandedEdit）负责。
      // 这里通过 props.content 接收已加载的内容。
      var content = props.content;
      if (content === void 0 || content === null) {
        blocks.push(createElement("div", { className: "wc-loading", key: "load" },
          props.loadFailed ? t(ctx, "loadFailed") : "…"
        ));
      } else {
        // 单流内联对比：改动行高亮，上下文只留 ±3 行——窄栏里这是唯一可读的形态，
        // 两整块上下摆等于让用户自己当 diff 算法。
        blocks.push(createElement(DiffBlock, {
          key: "diff",
          edit: edit,
          content: content,
          ctx: ctx,
          onCopy: onCopy
        }));
      }
      return createElement("div", { className: "wc-edit" }, blocks);
    }

    // ── 展开态编辑：负责懒加载内容（fetch host RPC） ──
    // loadState: undefined=加载中, null=加载失败, {…}=成功
    function ExpandedEdit(props) {
      var edit = props.edit;
      var ctx = props.ctx;
      var sessionId = props.sessionId;
      var onCopy = props.onCopy;
      var filePath = props.filePath;

      var loadState = useState(void 0);
      var loadData = loadState[0];
      var setLoadData = loadState[1];

      useEffect(function () {
        if (edit.sensitive) { setLoadData(void 0); return; }
        if (sessionId === void 0 || typeof edit.callId !== "string" || edit.callId === "") {
          setLoadData(null);
          return;
        }
        var alive = true;
        var controller = typeof AbortController === "function" ? new AbortController() : void 0;
        setLoadData(void 0);
        fetch("/api/what-changed/diff", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: sessionId, callId: edit.callId, path: filePath }),
          cache: "no-store",
          ...(controller === void 0 ? {} : { signal: controller.signal })
        }).then(function (r) { return r.json(); }).then(function (data) {
          if (alive) setLoadData(data && data.ok && data.value ? data.value : null);
        }).catch(function () { if (alive) setLoadData(null); });
        return function () {
          alive = false;
          // 折叠/切文件时取消在飞的请求，长 diff 不再白白占用连接。
          if (controller !== void 0) controller.abort();
        };
      }, [edit.callId, sessionId, edit.sensitive, filePath]);

      return createElement(EditBlocks, {
        edit: edit,
        ctx: ctx,
        content: loadData,
        loadFailed: loadData === null,
        ofCount: props.ofCount,
        onCopy: onCopy
      });
    }

    // ── 一条 shell 写入：命令原文懒加载 ──
    // 原文不进投影（可能带 inline 凭据），按 callId 从会话日志取回。
    function ShellRow(props) {
      var shell = props.shell;
      var ctx = props.ctx;
      var sessionId = props.sessionId;
      var onCopy = props.onCopy;

      var loadState = useState(void 0);
      var loaded = loadState[0];
      var setLoaded = loadState[1];
      var openState = useState(false);
      var open = openState[0];
      var setOpen = openState[1];
      var copyFlash = useCopyFlash();
      var copied = copyFlash[0];
      var flashCopied = copyFlash[1];

      useEffect(function () {
        if (sessionId === void 0 || typeof shell.callId !== "string" || shell.callId === "") {
          setLoaded(null);
          return;
        }
        var alive = true;
        var controller = typeof AbortController === "function" ? new AbortController() : void 0;
        setLoaded(void 0);
        fetch("/api/what-changed/diff", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: sessionId, callId: shell.callId, kind: "command" }),
          cache: "no-store",
          ...(controller === void 0 ? {} : { signal: controller.signal })
        }).then(function (r) { return r.json(); }).then(function (data) {
          if (alive) setLoaded(data && data.ok && data.value ? data.value : null);
        }).catch(function () { if (alive) setLoaded(null); });
        return function () {
          alive = false;
          if (controller !== void 0) controller.abort();
        };
      }, [shell.callId, sessionId]);

      var body;
      if (loaded === void 0) {
        body = createElement("span", { className: "wc-shellText wc-shellMuted" }, "…");
      } else if (loaded === null) {
        body = createElement("span", { className: "wc-shellText wc-shellMuted" }, t(ctx, "loadFailed"));
      } else if (loaded.redacted === true) {
        body = createElement("span", { className: "wc-shellText wc-shellRedacted" }, "🔒 " + t(ctx, "shellRedacted"));
      } else {
        var command = String(loaded.command === void 0 ? "" : loaded.command);
        var clipped = command.indexOf("\n") !== -1 || command.length > 120;
        body = createElement("span", {
          className: open ? "wc-shellText wc-shellOpen" : "wc-shellText",
          // 截断态给 title：鼠标悬停能看全，不必先展开。
          title: clipped && !open ? command : void 0
        }, command);
        if (clipped) {
          body = createElement("span", { className: "wc-shellTextWrap" },
            body,
            createElement("button", {
              type: "button",
              className: "wc-shellToggle",
              onClick: function () { setOpen(function (prev) { return !prev; }); },
              title: open ? t(ctx, "collapse") : t(ctx, "expandCommand"),
              "aria-label": open ? t(ctx, "collapse") : t(ctx, "expandCommand")
            }, open ? "▴" : "▾")
          );
        }
      }

      var showCopy = loaded !== void 0 && loaded !== null && loaded.redacted !== true;
      return createElement("div", { className: "wc-shellRow" },
        createElement("span", { className: "wc-shellPrompt" }, "$"),
        body,
        shell.repeat > 1 && createElement("span", { className: "wc-shellRepeat" }, t(ctx, "shellRepeat", { n: shell.repeat })),
        showCopy && createElement("button", {
          type: "button",
          className: "wc-shellCopy",
          onClick: function () {
            var p = onCopy(String(loaded.command === void 0 ? "" : loaded.command));
            if (p && typeof p.then === "function") p.then(function (ok) { if (ok) flashCopied(); });
            else flashCopied();
          },
          title: copied ? t(ctx, "copied") : t(ctx, "copy"),
          "aria-label": copied ? t(ctx, "copied") : t(ctx, "copy")
        }, copied ? "✓" : "⎘")
      );
    }

    // ── 一轮里的 shell 写入组 ──
    // 默认折叠：命令原文是懒加载的，不展开就不发请求。
    // 同轮相同命令的合并（repeat）已在 host 的投影里做完，这里按顺序渲染即可。
    function ShellGroup(props) {
      var shells = props.shells;
      var ctx = props.ctx;
      var sessionId = props.sessionId;
      var onCopy = props.onCopy;
      var openState = useState(false);
      var open = openState[0];
      var setOpen = openState[1];

      if (shells.length === 0) return null;
      return createElement("div", { className: "wc-shellGroup" },
        createElement("button", {
          type: "button",
          className: "wc-shellHead",
          onClick: function () { setOpen(function (prev) { return !prev; }); },
          "aria-expanded": open ? "true" : "false"
        },
          createElement("span", { className: "wc-caret" }, open ? "\u25BE" : "\u25B8"),
          createElement("span", { className: "wc-shellHeadText" }, t(ctx, "shellHead", { n: shells.length }))
        ),
        open && createElement("div", { className: "wc-shellBody" },
          createElement("div", { className: "wc-shellHint" }, t(ctx, "shellHint")),
          shells.map(function (s) {
            return createElement(ShellRow, {
              key: s.callId,
              shell: s,
              ctx: ctx,
              sessionId: sessionId,
              onCopy: onCopy
            });
          })
        )
      );
    }

    // ── 单个文件（按轮次视图）：默认逐次修改，「全文对照」切换到整文件 diff ──
    // 整文件状态来自 host 的编辑前快照（最可靠），快照缺失退回反向重建；
    // 这份"每轮改完后的完整文件"也是之后回退功能的基石。
    function FileGroup(props) {
      var file = props.file;        // 本轮该文件的编辑子集
      var full = props.full || file; // 整个会话的完整编辑史（重建用）
      var turnNo = props.turnNo;
      var open = props.open;
      var onToggle = props.onToggle;
      var ctx = props.ctx;
      var sessionId = props.sessionId;
      var editCount = (file.edits || []).length;
      var refusalCount = (file.refusals || []).length;
      var onOpenInEditor = props.onOpenInEditor;
      var sensitive = file.sensitive === true;
      // 本轮是否已结束（投影的 lastEndedTurn >= turnNo）。按钮的两种形态完全由
      // 这个信号决定：进行中显示禁用占位，结束自动变成可点的「全文对照」——
      // 不需要任何数据预取，也不需要用户收起再展开。
      var roundEnded = props.roundEnded === true;

      // 展示形态：默认"逐次修改"（每处编辑一条内联对比），「全文对照」点开才切。
      var viewState = useState("edits");
      var view = viewState[0];
      var setView = viewState[1];

      // 全文对照的数据：**已结束的轮次**在文件块打开时就拉取，用真实数据判定
      // 按钮该不该出现——"生成了再展示"，不存在能点但点不出数据的按钮。
      // 进行中的轮次不拉（占位不依赖数据，零请求）；轮次结束的瞬间 roundEnded
      // 翻转，这里自动开始拉取，按钮随之自动出现。
      // 一个 kind:"whole" 请求带回全部原料（磁盘内容 + 快照 + 片段史），
      // 不再拆成三个请求。snaps/roundAfter 已落盘持久化；recon = 反向套补丁
      // 重建（快照缺失时的兜底）。磁盘内容只喂给 recon，不进 React state。
      var loadState = useState(void 0); // undefined=未拉, null=失败, {snaps, roundAfter, recon}
      var loaded = loadState[0];
      var setLoaded = loadState[1];
      useEffect(function () {
        if (open !== true || roundEnded !== true || sensitive || editCount === 0 || loaded !== void 0) return;
        var alive = true;
        // 卸载/折叠时中止在飞请求：整文件内容最大 512KB，不该白下载。
        var controller = typeof AbortController === "function" ? new AbortController() : void 0;
        fetch("/api/what-changed/diff", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "whole", sessionId: sessionId, path: file.path }),
          cache: "no-store",
          ...(controller === void 0 ? {} : { signal: controller.signal })
        }).then(function (r) { return r.json(); }).then(function (data) {
          if (!alive) return;
          var v = data && data.ok && data.value ? data.value : null;
          if (v === null || v.file === void 0 || v.file.exists !== true || typeof v.file.content !== "string") {
            setLoaded(null);
            return;
          }
          var snaps = v.snapshots ? v.snapshots : {};
          var roundAfter = v.roundAfter ? v.roundAfter : {};
          var edits = Array.isArray(v.edits) ? v.edits.slice() : [];
          edits.sort(function (a, b) { return (a.time || 0) - (b.time || 0); });
          setLoaded({ snaps: snaps, roundAfter: roundAfter, recon: reconstructStates(edits, v.file.content) });
        }).catch(function () { if (alive) setLoaded(null); });
        return function () {
          alive = false;
          if (controller !== void 0) controller.abort();
        };
        // 成功/失败缓存都跨折叠保留；块随新一轮 key 变化重挂时自然失效。
      }, [open, roundEnded, sensitive, editCount, loaded, file.path, sessionId]);

      // 失败缓存的重试机会：请求失败（null）在重新展开文件块时清掉重试。
      // 成功缓存不清（没必要重复下载）。
      var prevOpenRef = useRef(open);
      useEffect(function () {
        if (prevOpenRef.current === open) return;
        prevOpenRef.current = open;
        if (open === true && loaded === null) setLoaded(void 0);
      }, [open, loaded]);

      // 注意：这里不做任何"预先否决"。曾试过用轻量探测决定按钮去留，但快照
      // 只代表可用性的一半——改前/改后状态还能从会话日志的编辑片段反向重建
      // （recon），探测看不到这一层，会把有救的轮次误杀成整行消失（重启后
      // 快照文档尚未生成时的真实事故）。最终语义：按钮乐观显示，轮次结束即
      // 可点；点了拉不出数据再单独撤掉这一个按钮，绝不牵连「逐次修改」。

      // 先把"本轮第一处编辑 / 下一轮第一处编辑"的 callId 提炼成原始值：
      // full 的对象引用在会话活跃时每个事件都会变（投影 view 重建），
      // memo 若直接依赖 full，已打开的全文对照会跟着每个事件重算 diffRows
      // （最坏 300×300 DP）。依赖原始 callId 字符串后，内容没变就跳过重算。
      var bounds = useMemo(function () {
        var asc = (full.edits || []).slice().reverse();
        var firstOfTurn = null, firstOfNewer = null;
        for (var i = 0; i < asc.length; i += 1) {
          var e = asc[i];
          if (e.turn === turnNo) { if (firstOfTurn === null) firstOfTurn = e.callId; }
          else if (e.turn > turnNo && firstOfNewer === null) { firstOfNewer = e.callId; break; }
        }
        return [firstOfTurn === null ? "" : firstOfTurn, firstOfNewer === null ? "" : firstOfNewer];
      }, [full, turnNo]);
      var firstOfTurnCallId = bounds[0];
      var firstOfNewerCallId = bounds[1];

      // 全文对照 = diff(本轮第一处编辑的改前快照, 本轮的改后快照)。
      // 改前：编辑前快照优先，老轮次退回反向重建。
      // 改后：turn/end 落定的轮后快照优先，有下一轮则用下一轮的改前快照；
      //       都没有 = 已结束但改后不可知（快照丢失且重建失败），返回 null，
      //       按钮不出现。进行中的轮次根本不会拉数据（loaded 恒为未拉），
      //       "进行中"占位由 roundEnded 直接驱动，不经过这里。
      var wholeRows = useMemo(function () {
        if (loaded === void 0 || loaded === null) return null;
        if (firstOfTurnCallId === "") return null;
        var hasOwn = Object.prototype.hasOwnProperty;
        var before;
        if (hasOwn.call(loaded.snaps, firstOfTurnCallId)) {
          before = loaded.snaps[firstOfTurnCallId]; // null = 当时文件还不存在（创建）
        } else if (loaded.recon.valid[firstOfTurnCallId] === true) {
          before = loaded.recon.before[firstOfTurnCallId];
        } else {
          return null; // 改前状态拿不到
        }
        var after;
        if (hasOwn.call(loaded.roundAfter, String(turnNo))) {
          after = loaded.roundAfter[String(turnNo)]; // 本轮结束时的落盘状态（null=文件已删）
        } else if (firstOfNewerCallId !== "") {
          if (hasOwn.call(loaded.snaps, firstOfNewerCallId)) after = loaded.snaps[firstOfNewerCallId];
          else if (loaded.recon.valid[firstOfNewerCallId] === true) after = loaded.recon.before[firstOfNewerCallId];
          else return null; // 下一轮的改前拿不到，本轮的改后也就不可知
        } else {
          return null; // 最新一轮已结束但改后不可知
        }
        return diffRows(before === null ? void 0 : before, after === null ? void 0 : after, 1, 1);
      }, [loaded, firstOfTurnCallId, firstOfNewerCallId, turnNo]);

      // 全文对照是否可用：数据拉下来且真的拼得出对比，才算可用。
      // 这是按钮出现的唯一依据——"生成了再展示"，没有任何乐观/预判成分。
      var wholeAvailable = wholeRows !== null;
      // 切换行可见性：
      //   进行中 → 显示（占位告诉用户全文对照会在轮次结束后出现）；
      //   已结束 → 只有数据确认可用才显示；确认不可用/还在拉取 → 整行不渲染，
      //   按钮从没出现过，也就不存在"点了消失"或"能点但点不出"。
      var showSwapRow = !sensitive && editCount > 0 && (roundEnded !== true || wholeAvailable === true);
      var effectiveView = view === "whole" && showSwapRow ? "whole" : "edits";

      return createElement("div", { className: "wc-file" },
        // 折叠头是一行两个兄弟按钮：HTML 不允许 button 里嵌 button（浏览器会把内层
        // 拆出去，点击行为随之失控），所以"打开编辑器"必须放在 header 按钮外面。
        createElement("div", { className: "wc-fileRow" },
          createElement("button", {
            type: "button",
            className: "wc-fileHead",
            onClick: onToggle,
            "aria-expanded": open ? "true" : "false"
          },
            createElement("span", { className: "wc-caret" }, open ? "\u25BE" : "\u25B8"),
            createElement("span", { className: "wc-path", title: file.path }, file.path),
            editCount > 0 && createElement("span", { className: "wc-fileCount" }, t(ctx, "edits", { n: editCount })),
            refusalCount > 0 && createElement("span", { className: "wc-refusalCount" }, t(ctx, "refused", { n: refusalCount }))
          ),
          createElement("button", {
            type: "button",
            className: "wc-openBtn",
            onClick: function () { onOpenInEditor(file.path); },
            title: t(ctx, "openInEditor"),
            "aria-label": t(ctx, "openInEditor")
          }, "\u2197")
        ),
        open && createElement("div", { className: "wc-fileBody" },
          sensitive === true && createElement("div", { className: "wc-sensitive" }, "🔒 " + t(ctx, "sensitive")),
          showSwapRow && createElement("div", { className: "wc-viewSwap" },
            createElement("button", {
              type: "button",
              className: "wc-swapBtn" + (effectiveView === "edits" ? " wc-swapActive" : ""),
              onClick: function () { setView("edits"); },
              "aria-pressed": effectiveView === "edits" ? "true" : "false"
            }, t(ctx, "perEdits")),
            // 行内只可能有两种第二按钮：进行中的禁用占位，或确认可用的可点按钮。
            // 已结束但数据不可用的轮次整行都不渲染（见 showSwapRow）。
            roundEnded
              ? createElement("button", {
                  type: "button",
                  className: "wc-swapBtn" + (effectiveView === "whole" ? " wc-swapActive" : ""),
                  onClick: function () { setView("whole"); },
                  "aria-pressed": effectiveView === "whole" ? "true" : "false"
                }, t(ctx, "wholeView"))
              : createElement("button", {
                  type: "button",
                  className: "wc-swapBtn wc-swapWait",
                  disabled: true,
                  title: t(ctx, "wholeOngoingHint"),
                  "aria-disabled": "true"
                }, t(ctx, "wholeOngoing"))
          ),
          // effectiveView==="whole" 蕴含 showSwapRow 蕴含 wholeAvailable：
          // 可点按钮只在数据就绪后渲染，这里不需要任何加载占位分支。
          !sensitive && effectiveView === "whole" && createElement("div", { className: "wc-wholeArea" },
            createElement(TurnDiffBlock, {
              rows: wholeRows,
              ctx: ctx,
              onCopy: props.onCopy,
              label: t(ctx, "turnNet")
            })
          ),
          ((!sensitive && effectiveView !== "whole") || sensitive) && createElement("div", { className: "wc-editsList" },
            (file.edits || []).map(function (edit, i) {
              return createElement(ExpandedEdit, {
                key: (edit.callId || "e") + ":" + i,
                edit: edit,
                ctx: ctx,
                sessionId: sessionId,
                filePath: file.path,
                // "共几次"由客户端用整会话史现算（view 不再随每条记录推送 of）。
                ofCount: (full.edits || []).length || editCount,
                onCopy: props.onCopy
              });
            })
          ),
          (file.refusals || []).length > 0 && createElement("div", { className: "wc-refusals" },
            createElement("div", { className: "wc-refusalsHead" }, t(ctx, "refusedHead")),
            (file.refusals || []).map(function (r, i) {
              return createElement("div", { className: "wc-refusal", key: "r" + i },
                createElement("span", { className: "wc-toolTag" }, toolLabel(ctx, r.tool)),
                createElement("span", { className: "wc-refusalReason" }, r.reason)
              );
            })
          )
        )
      );
    }

    // ── 整文件状态重建：从磁盘当前内容反向套补丁 ──
    // editsAsc 是该文件全部编辑（时间正序）。从最新往回，把 newText 换回 oldText，
    // 记下每处编辑"之前"的完整文件内容。任何一步定位不唯一/失败就停在那，
    // 比它新的编辑仍然有效（它们的 before 已记下），更老的退回碎片模式。
    // 优先按位置反转：applied diff 带片段在文件里的绝对行号（newStart/newLines），
    // 校验该行区间内容 === newText 后直接 splice 回 oldText——比字符串查找健壮，
    // 不怕同片段在文件里出现多次。
    function invertAtPosition(content, e) {
      if (typeof e.newStart !== "number" || typeof e.newLines !== "number") return null;
      var lines = content.split("\n");
      var start = e.newStart - 1;
      var end = start + e.newLines;
      if (start < 0 || end > lines.length) return null;
      if (lines.slice(start, end).join("\n") !== e.newText) return null;
      var mid = e.oldText === "" ? [] : e.oldText.split("\n");
      return lines.slice(0, start).concat(mid, lines.slice(end)).join("\n");
    }
    function countOccurrences(hay, needle) {
      if (needle === "") return 0;
      var n = 0, at = hay.indexOf(needle);
      while (at !== -1) { n += 1; at = hay.indexOf(needle, at + needle.length); }
      return n;
    }
    function invertOnce(content, e) {
      var at = content.indexOf(e.newText);
      if (at === -1 || countOccurrences(content, e.newText) !== 1) return null;
      return content.slice(0, at) + e.oldText + content.slice(at + e.newText.length);
    }
    function reconstructStates(editsAsc, diskContent) {
      var content = diskContent;
      var before = {};   // callId → 该编辑执行前的完整文件内容（create 编辑为 null=文件不存在）
      var valid = {};    // callId → true（before 可信）
      for (var i = editsAsc.length - 1; i >= 0; i -= 1) {
        var e = editsAsc[i];
        // 先反转 e 自己，反转后的内容才是"e 执行前"的状态；create 无法反转，
        // 之前文件不存在，直接记 null 收工。
        if (e.oldText === void 0) { before[e.callId] = null; valid[e.callId] = true; break; }
        if (typeof e.newText !== "string") break;
        var next = invertAtPosition(content, e);
        if (next === null) next = invertOnce(content, e);
        if (next === null) break; // 定位失败：更早的状态不可信，到此为止
        content = next;
        before[e.callId] = content;
        valid[e.callId] = true;
      }
      return { before: before, valid: valid };
    }

    // ── 整轮文件对比块：头部=轮次+±合计，正文复用行渲染 ──
    function TurnDiffBlock(props) {
      var rows = props.rows;
      var ctx = props.ctx;
      var label = props.label;
      var onCopy = props.onCopy;

      var copyFlash = useCopyFlash();
      var copied = copyFlash[0];
      var flashCopied = copyFlash[1];

      var addCount = 0, remCount = 0;
      rows.forEach(function (r) {
        if (r.t === "+") addCount += 1;
        if (r.t === "-") remCount += 1;
      });
      var copyText = rows.map(function (r) {
        return (r.t === "+" ? "+ " : r.t === "-" ? "- " : "  ") + r.text;
      }).join("\n");

      return createElement("div", { className: "wc-diff" },
        createElement("div", { className: "wc-diffTop" },
          createElement("span", { className: "wc-diffRange" },
            label + " · +" + addCount + " −" + remCount),
          createElement("button", {
            type: "button",
            className: "wc-copyBtn",
            title: t(ctx, "copy"),
            onClick: function () {
              var p = onCopy(copyText);
              if (p && typeof p.then === "function") p.then(function (ok) { if (ok) flashCopied(); });
              else flashCopied();
            }
          }, copied ? t(ctx, "copied") : t(ctx, "copy"))
        ),
        createElement(DiffRowsComponent, { rows: rows, ctx: ctx })
      );
    }

    // ── 折叠状态容器 ──
    // 逻辑：默认只展开「最新轮」的文件，其余关闭（省内存）。
    // 当 latestTurn 变化（新的一轮出现），自动展开新最新轮、关闭旧最新轮；
    // 用户手动点开旧轮能看，但下一次 latestTurn 变化时归位到"仅最新轮展开"。
    function CollapsibleFile(props) {
      var file = props.file;
      var defaultOpen = props.defaultOpen;
      var sessionId = props.sessionId;

      var openState = useState(defaultOpen);
      var open = openState[0];
      var setOpen = openState[1];

      // 监听 defaultOpen 变化：新轮出现 → 最新轮自动展开、旧轮自动关闭
      var prevDefault = useRef(defaultOpen);
      useEffect(function () {
        if (prevDefault.current !== defaultOpen) {
          prevDefault.current = defaultOpen;
          setOpen(defaultOpen);
        }
      }, [defaultOpen]);

      var toggleOpen = useCallback(function () {
        setOpen(function (prev) { return !prev; });
      }, []);

      var onCopy = useCallback(copyToClipboard, []);

      return createElement(FileGroup, {
        file: file,
        full: props.full || file,
        turnNo: props.turnNo,
        open: open,
        onToggle: toggleOpen,
        ctx: props.ctx,
        sessionId: sessionId,
        roundEnded: props.roundEnded,
        onOpenInEditor: props.onOpenInEditor,
        onCopy: onCopy
      });
    }

    // ── tab 主体 ──
    function ChangedTab(props) {
      var ctx = props.ctx;
      var sessionId = props.scope ? props.scope.sessionId : void 0;

      var subscribe = useCallback(function (cb) {
        var face = faceOf(ctx, sessionId);
        return face ? face.subscribe(cb) : function () {};
      }, [ctx, sessionId]);

      var getSnapshot = useCallback(function () {
        var face = faceOf(ctx, sessionId);
        return face ? face.getSnapshot() : void 0;
      }, [ctx, sessionId]);

      var data = useSyncExternalStore(subscribe, getSnapshot);

      // 提前计算分组（hooks 必须在所有条件 return 之前，避免 React #310）
      // 这里的 files 用投影原始数据，groupByTurn 对空数组安全。
      var filesAll = (data && data.files) || [];
      var shellsAll = (data && data.shells) || [];
      var turnsAll = useMemo(function () { return groupByTurn(filesAll, shellsAll); }, [filesAll, shellsAll]);
      // 整会话的完整编辑史按路径索引：文件块重建整文件状态时要用全史，不是单轮子集。
      var fullByPath = useMemo(function () {
        var map = {};
        filesAll.forEach(function (f) { map[f.path] = f; });
        return map;
      }, [filesAll]);

      // shell 行/整文件对比的复制入口；文件块内的逐处复制由 CollapsibleFile 提供。
      var onCopyText = useCallback(copyToClipboard, []);

      // 同样必须在条件 return 之前声明。
      var openInEditor = useCallback(function (path) {
        try {
          // 这里的 ctx 是 better-sidebar 传进来的渲染 ctx，可能没声明本插件的依赖。
          var svc = serviceOf(ctx, "betterSidebar");
          if (svc === void 0) return;
          // openFile 会带上文件名标题并按 `editor:<path>` 去重；裸 openTab 每次都会
          // 落一个无标题的新 editor tab，所以优先走 openFile。
          if (typeof svc.openFile === "function" && sessionId !== void 0) {
            svc.openFile({ sessionId: sessionId }, path);
            return;
          }
          svc.openTab(
            { type: "editor", path: path, id: "editor:" + path, title: baseNameOf(path) },
            sessionId === void 0 ? void 0 : { sessionId: sessionId }
          );
        } catch (e) { /* editor open failed */ }
      }, [ctx, sessionId]);

      if (data === void 0) {
        return createElement("div", { className: "wc-empty" }, t(ctx, "loading"));
      }

      var files = data.files || [];
      var shells = data.shells || [];
      var totalEdits = data.totalEdits || 0;
      var totalRefused = data.totalRefused || 0;
      var shellWrites = data.shellWrites || 0;

      if (files.length === 0 && shells.length === 0) {
        return createElement("div", { className: "wc-empty" }, t(ctx, "empty"));
      }

      var turns = turnsAll;
      // 最新轮次默认展开
      var latestTurn = turns.length > 0 ? turns[0].turn : void 0;
      // 已结束的最大轮号（host 在 turn/end 记录）。轮次结束时这个值变化，
      // 文件块据此重取轮后快照，「本轮进行中…」自动变成可点的「全文对照」。
      var lastEndedTurn = typeof data.lastEndedTurn === "number" ? data.lastEndedTurn : -1;

      var bodyChildren = turns.map(function (tg) {
        return createElement("div", { className: "wc-turn", key: tg.turn },
          createElement("div", { className: "wc-turnHead" }, t(ctx, "turn", { n: tg.turn })),
          tg.files.map(function (f) {
            return createElement(CollapsibleFile, {
              // key 带最新轮号：新一轮出现时旧块重挂，缓存与视图状态自然失效
              key: latestTurn + ":" + tg.turn + ":" + f.path,
              file: f,
              full: fullByPath[f.path] || f,
              turnNo: tg.turn,
              ctx: ctx,
              sessionId: sessionId,
              roundEnded: tg.turn <= lastEndedTurn,
              defaultOpen: tg.turn === latestTurn,
              onOpenInEditor: openInEditor
            });
          }),
          // shell 写入排在这一轮的文件改动之后：它是补充信息，不是主线。
          createElement(ShellGroup, {
            key: "shells",
            shells: tg.shells || [],
            ctx: ctx,
            sessionId: sessionId,
            onCopy: onCopyText
          })
        );
      });

      return createElement("div", { className: "wc-tab" },
        createElement("div", { className: "wc-summary" },
          t(ctx, "summary", { files: files.length, edits: totalEdits })
            + (totalRefused > 0 ? t(ctx, "refusedSummary", { n: totalRefused }) : "")
            + (shellWrites > 0 ? t(ctx, "shellSummary", { n: shellWrites }) : "")
        ),
        bodyChildren
      );
    }

    // ── 设置面板：自动打开开关 ──
    // 用 settings.render 而不是 pluginToggles：better-sidebar 的声明式 switch 按
    // `value === true` 渲染，未设置的键会显示"关"，而本插件的默认行为是"开"。
    // 自己渲染这一行，显示状态与实际行为就共用同一个默认值（缺省 = 开）。
    function AutoOpenSetting(props) {
      var ctx = props.ctx;
      var panel = props.panel;
      var blob = panel.pluginSettings || {};
      var on = blob.autoOpen !== false;
      return createElement("div", { className: "wc-setRow" },
        createElement("span", { className: "wc-setText" },
          createElement("span", { className: "wc-setTitle" }, t(ctx, "autoOpenLabel")),
          createElement("span", { className: "wc-setDesc" }, t(ctx, "autoOpenDesc"))
        ),
        createElement("label", { className: "wc-setSwitch" },
          createElement("input", {
            type: "checkbox",
            className: "wc-setInput",
            checked: on,
            "aria-label": t(ctx, "autoOpenLabel"),
            onChange: function (e) { panel.updatePluginSetting("autoOpen", e.target.checked); }
          }),
          createElement("span", { className: "wc-setTrack" },
            createElement("span", { className: "wc-setThumb" })
          )
        )
      );
    }

    var STYLES = [
      ".wc-tab{height:100%;overflow-y:auto;overflow-x:hidden;padding:10px;display:flex;flex-direction:column;gap:10px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,inherit)}",
      ".wc-summary{padding:8px 12px;border-radius:8px;background:var(--dsw-alias-interactive-bg,rgba(97,135,216,.08));color:var(--dsw-alias-label-secondary,inherit);font-size:.85em}",
      ".wc-turn{display:flex;flex-direction:column;gap:8px}",
      ".wc-turnHead{font-weight:600;font-size:.95em;padding:2px 0;border-bottom:1px solid var(--dsw-alias-border-line,rgba(0,0,0,.1))}",
      ".wc-file{display:flex;flex-direction:column}",
      ".wc-fileRow{display:flex;align-items:center;gap:2px;border-left:2px solid var(--dsw-alias-border-line,rgba(0,0,0,.08))}",
      ".wc-fileRow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}",
      ".wc-fileHead{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0;padding:6px 8px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}",
      ".wc-caret{flex:0 0 auto;width:12px;color:var(--dsw-alias-label-secondary,inherit)}",
      ".wc-path{font-family:ui-monospace,Menlo,monospace;font-size:.85em;overflow-wrap:anywhere;flex:1 1 auto;color:var(--dsw-alias-label-primary,inherit)}",
      ".wc-fileCount{flex:0 0 auto;font-size:.78em;color:var(--dsw-alias-label-secondary,inherit)}",
      ".wc-refusalCount{flex:0 0 auto;font-size:.78em;font-weight:600;color:var(--dsw-alias-state-danger-primary,#a12020)}",
      ".wc-openBtn{flex:0 0 auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary,inherit);cursor:pointer;font:inherit;font-size:.9em;padding:4px 6px}",
      ".wc-openBtn:hover{color:var(--dsw-alias-link,#2f6fed)}",
      ".wc-refusals{margin-top:4px;padding:8px 10px;border-radius:6px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 30%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 8%,transparent)}",
      ".wc-refusalsHead{font-size:.78em;font-weight:600;color:var(--dsw-alias-state-danger-primary,#a12020);margin-bottom:6px}",
      ".wc-refusal{display:flex;align-items:center;gap:6px;padding:2px 0}",
      ".wc-refusalReason{font-size:.8em;color:var(--dsw-alias-state-danger-primary,#a12020);font-family:ui-monospace,Menlo,monospace}",
      ".wc-fileBody{display:flex;flex-direction:column;gap:10px;padding:8px 0 4px 8px}",
      ".wc-editsList{display:flex;flex-direction:column;gap:10px}",
      ".wc-viewSwap{display:flex;gap:4px;margin-bottom:2px}",
      ".wc-swapBtn{padding:3px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-line,rgba(0,0,0,.15));background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:.78em;cursor:pointer}",
      ".wc-swapBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08))}",
      ".wc-swapWait{opacity:.55;cursor:default}",
      ".wc-swapWait:hover{background:transparent}",
      ".wc-swapActive{background:var(--dsw-alias-interactive-bg,rgba(97,135,216,.12));color:var(--dsw-alias-label-primary,inherit);font-weight:600;border-color:var(--dsw-alias-border-strong,rgba(0,0,0,.3))}",
      ".wc-wholeArea{display:flex;flex-direction:column;gap:8px}",
      ".wc-edit{display:flex;flex-direction:column;gap:8px}",
      ".wc-editMeta{display:flex;align-items:center;gap:6px}",
      ".wc-toolTag{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;font-size:.75em;font-weight:600;background:var(--dsw-alias-interactive-bg,rgba(97,135,216,.12));color:var(--dsw-alias-label-secondary,inherit);font-family:ui-monospace,Menlo,monospace}",
      ".wc-kindTag{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;font-size:.75em;font-weight:600;background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 15%,transparent);color:var(--dsw-alias-state-success-primary,#1a7f37)}",
      ".wc-loading{color:var(--dsw-alias-label-secondary,inherit);font-size:.8em;padding:4px 8px}",
      ".wc-sensitive{padding:8px 10px;border-radius:6px;font-size:.8em;color:var(--dsw-alias-state-danger-primary,#a12020);background:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 8%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 30%,transparent)}",
      ".wc-diff{border:1px solid var(--dsw-alias-border-line,rgba(0,0,0,.12));border-radius:6px;overflow:hidden}",
      ".wc-diffTop{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 10px;font-size:.78em;font-weight:600;background:var(--dsw-alias-interactive-bg,rgba(97,135,216,.08));color:var(--dsw-alias-label-secondary,inherit)}",
      ".wc-diffRange{flex:1 1 auto;min-width:0;font-family:ui-monospace,Menlo,monospace}",
      ".wc-copyBtn{flex:0 0 auto;border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:.9em;opacity:.7;padding:0 4px}",
      ".wc-copyBtn:hover{opacity:1}",
      ".wc-dcode{padding:4px 0;overflow-x:auto;font-family:ui-monospace,Menlo,monospace;font-size:.8em;line-height:1.5}",
      ".wc-drow{display:flex;min-width:0;padding:0 8px 0 0}",
      ".wc-dno{flex:0 0 auto;width:26px;text-align:right;padding-right:2px;color:var(--dsw-alias-label-secondary,inherit);opacity:.75;user-select:none}",
      ".wc-dsgn{flex:0 0 auto;width:10px;text-align:center;user-select:none;opacity:.85}",
      ".wc-dtx{flex:1 1 auto;min-width:0;white-space:pre-wrap;word-break:break-word}",
      ".wc-dadd{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 13%,transparent)}",
      ".wc-dadd .wc-dsgn{color:var(--dsw-alias-state-success-primary,#1a7f37);font-weight:700}",
      ".wc-ddel{background:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 11%,transparent)}",
      ".wc-ddel .wc-dsgn{color:var(--dsw-alias-state-danger-primary,#a12020);font-weight:700}",
      ".wc-dgap{display:block;width:100%;border:0;background:color-mix(in srgb,var(--dsw-alias-interactive-bg,rgba(0,0,0,.03)) 60%,transparent);color:var(--dsw-alias-label-secondary,inherit);cursor:pointer;font:inherit;font-size:.85em;padding:2px 8px;text-align:center}",
      ".wc-dgap:hover{color:var(--dsw-alias-link,#2f6fed);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}",
      ".wc-dempty{padding:8px 10px;font-size:.82em;color:var(--dsw-alias-label-secondary,inherit);font-style:italic}",
      ".wc-empty{margin:8px 4px;font-size:.86em;color:var(--dsw-alias-label-secondary,inherit)}",
      ".wc-shellGroup{display:flex;flex-direction:column;margin-top:2px}",
      ".wc-shellHead{display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;border:0;border-left:2px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,orange) 45%,transparent);background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:.82em;text-align:left;cursor:pointer}",
      ".wc-shellHead:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}",
      ".wc-shellHeadText{flex:1 1 auto;min-width:0}",
      ".wc-shellBody{display:flex;flex-direction:column;gap:2px;padding:6px 0 4px 18px}",
      ".wc-shellHint{font-size:.76em;color:var(--dsw-alias-label-secondary,inherit);padding:0 4px 4px}",
      ".wc-shellRow{display:flex;align-items:flex-start;gap:6px;padding:3px 6px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,orange) 6%,transparent);font-family:ui-monospace,Menlo,monospace;font-size:.8em;min-width:0}",
      ".wc-shellPrompt{flex:0 0 auto;color:var(--dsw-alias-state-warn-primary,#8a5a00);user-select:none}",
      ".wc-shellTextWrap{display:flex;align-items:flex-start;gap:4px;flex:1 1 auto;min-width:0}",
      ".wc-shellText{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary,inherit)}",
      ".wc-shellOpen{white-space:pre-wrap;word-break:break-all;overflow:visible}",
      ".wc-shellMuted{color:var(--dsw-alias-label-secondary,inherit);font-style:italic}",
      ".wc-shellRedacted{color:var(--dsw-alias-state-danger-primary,#a12020)}",
      ".wc-shellToggle{flex:0 0 auto;border:0;background:transparent;color:var(--dsw-alias-link,#2f6fed);cursor:pointer;font:inherit;font-size:.9em;padding:0 2px}",
      ".wc-shellRepeat{flex:0 0 auto;color:var(--dsw-alias-label-secondary,inherit)}",
      ".wc-shellCopy{flex:0 0 auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary,inherit);cursor:pointer;font:inherit;opacity:.7;padding:0 2px}",
      ".wc-shellCopy:hover{opacity:1}",
      ".wc-seqTag{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;font-size:.75em;font-weight:600;background:var(--dsw-alias-interactive-bg,rgba(97,135,216,.12));color:var(--dsw-alias-label-primary,inherit)}",
      ".wc-latestTag{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;font-size:.75em;font-weight:600;background:color-mix(in srgb,var(--dsw-alias-link,#2f6fed) 16%,transparent);color:var(--dsw-alias-link,#2f6fed)}",
      ".wc-setRow{display:flex;align-items:center;gap:10px;padding:6px 2px}",
      ".wc-setText{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0}",
      ".wc-setTitle{font-size:.9em;color:var(--dsw-alias-label-primary,inherit)}",
      ".wc-setDesc{font-size:.78em;color:var(--dsw-alias-label-secondary,inherit)}",
      ".wc-setSwitch{flex:0 0 auto;position:relative;display:inline-flex;cursor:pointer}",
      ".wc-setInput{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}",
      ".wc-setTrack{display:inline-flex;align-items:center;width:34px;height:18px;padding:2px;border-radius:999px;background:var(--dsw-alias-border-line,rgba(0,0,0,.2));transition:background .15s}",
      ".wc-setThumb{width:14px;height:14px;border-radius:50%;background:#fff;transform:translateX(0);transition:transform .15s}",
      ".wc-setInput:checked+.wc-setTrack{background:var(--dsw-alias-state-success-primary,#1a7f37)}",
      ".wc-setInput:checked+.wc-setTrack .wc-setThumb{transform:translateX(16px)}",
      ".wc-setInput:focus-visible+.wc-setTrack{outline:2px solid var(--dsw-alias-link,#2f6fed);outline-offset:2px}"
    ].join("");

    function apply(ctx) {
      var betterSidebar = ctx.get("betterSidebar");

      ctx.effect(function () {
        var tag = document.createElement("style");
        tag.setAttribute("data-plugin", "dsw-what-changed-sidebar");
        tag.textContent = STYLES;
        document.head.appendChild(tag);
        return function () { if (tag.parentNode !== null) tag.parentNode.removeChild(tag); };
      }, "dsh-what-changed-sidebar: styles");

      if (betterSidebar === void 0) return;

      ctx.effect(function () {
        return betterSidebar.registerTab({
          id: "what-changed-sidebar",
          title: function () { return t(ctx, "tabTitle"); },
          icon: createElement("span", null, "\u{1F4DD}"),
          order: 60,
          // 单实例：自动弹出反复调用 openTab 时聚焦已有 tab，不再堆重复页。
          single: true,
          component: function (props) { return createElement(ChangedTab, props); },
          // 角标：有改动时显示总数
          badge: function (c, scope, state) {
            try {
              var face = faceOf(c, scope.sessionId);
              if (face === void 0) return void 0;
              var snap = face.getSnapshot();
              if (snap === void 0 || !snap.totalEdits) return void 0;
              return snap.totalEdits;
            } catch (e) { return void 0; }
          },
          // 设置：自动弹出开关（better-sidebar 持久化到 localStorage）
          settings: {
            render: function (panel) { return createElement(AutoOpenSetting, { ctx: ctx, panel: panel }); }
          }
        });
      }, "dsh-what-changed-sidebar: tab");

      ctx.effect(function () {
        var sessions = ctx.sessions;
        var currentId = sessions.list.getSnapshot().current;
        var baseline = 0;
        var lastAutoTurn = -1;
        var unsubFace = null;

        var rewire = function () {
          if (unsubFace !== null) { unsubFace(); unsubFace = null; }
          var id = sessions.list.getSnapshot().current;
          currentId = id;
          lastAutoTurn = -1;
          baseline = 0;
          if (id === void 0) return;
          var binding = sessions.binding(id);
          if (binding === void 0 || binding.session === void 0 || binding.session.projections === void 0) return;
          var face = binding.session.projections.faceOf(KEY);
          if (face === void 0) return;
          var snap = face.getSnapshot();
          baseline = (snap && snap.totalEdits) || 0;
          unsubFace = face.subscribe(function () {
            var cur = face.getSnapshot();
            var n = (cur && cur.totalEdits) || 0;
            if (n <= baseline) { baseline = n; return; }
            baseline = n;
            if (!autoOpenEnabled(ctx)) return;
            // 同一轮只弹一次：取最新 edit 的 turn 去重
            var latestTurn = -1;
            var filesArr = (cur && cur.files) || [];
            for (var i = 0; i < filesArr.length; i++) {
              var eds = filesArr[i].edits || [];
              for (var j = 0; j < eds.length; j++) if (eds[j].turn > latestTurn) latestTurn = eds[j].turn;
            }
            if (latestTurn === lastAutoTurn) return;
            lastAutoTurn = latestTurn;
            betterSidebar.openTab({ type: "what-changed-sidebar" }, { sessionId: id });
          });
        };

        rewire();
        var offList = sessions.list.subscribe(function () {
          var id = sessions.list.getSnapshot().current;
          // 换会话要重连；同一会话但当时还没绑定成功（unsubFace 为空）也要重试，
          // 否则冷启动那一刻绑定未就绪就永远收不到改动。
          if (id !== currentId || (id !== void 0 && unsubFace === null)) rewire();
        });

        return function () {
          offList();
          if (unsubFace !== null) unsubFace();
        };
      }, "dsh-what-changed-sidebar: auto-open");
    }

    // 读取 better-sidebar 的自动打开设置（pluginSettings 持久化在 sidebar store 的 prefs 里）
    // 语义：只有显式 false 才算关，缺省视为开（与设置面板的显示一致）。
    function autoOpenEnabled(ctx) {
      try {
        var service = serviceOf(ctx, "betterSidebar");
        if (service === void 0 || typeof service.getSnapshot !== "function") return true;
        var snap = service.getSnapshot();
        var ps = snap && snap.prefs && snap.prefs.pluginSettings;
        var mine = ps && ps["what-changed-sidebar"];
        return !(mine && mine.autoOpen === false);
      } catch (e) {
        return true;
      }
    }

    exports.inject = ["betterSidebar", "sessions", "locale"];
    exports.apply = apply;
    return module.exports;
  }
});
