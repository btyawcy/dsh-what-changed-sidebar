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
    var createElement = react.createElement;

    var KEY = "whatChangedSidebar";
    var MAX_BLOCK_LINES = 200;
    var MAX_PREVIEW_LINES = 30;

    // ── i18n（轻量：读 locale 服务选语言） ──
    var I18N = {
      zh: {
        loading: "加载改动记录中…",
        empty: "这个会话里 Agent 还没有写过任何文件。",
        summary: "{files} 个文件 · {edits} 处编辑",
        refusedSummary: " · {n} 处被拒",
        shellNote: "另有 {n} 条 shell 命令看起来写了文件，不在上面的列表里。shell 的结果不带任何文件信息，硬猜路径会猜错，所以这里只把缺口说出来。",
        turn: "第 {n} 轮",
        edits: "{n} 处改动",
        refused: "{n} 处被拒",
        refusedHead: "被拒绝的写入",
        before: "改动前",
        after: "改动后",
        created: "新建",
        createdContent: "新建内容",
        lineRange: "{label} · 第 {start}-{end} 行",
        lineRangeRelative: "{label}（块内 {start}-{end} 行）",
        sensitive: "敏感文件，内容已隐藏",
        expand: "展开剩余 {n} 行",
        collapse: "收起",
        searchPlaceholder: "搜索文件路径…",
        search: "搜索",
        clear: "取消",
        noResult: "没有匹配「{q}」的文件",
        openInEditor: "在编辑器中打开",
        copy: "复制",
        copied: "已复制",
        loadFailed: "内容加载失败（会话可能已关闭）",
        autoOpenLabel: "有文件改动时自动打开",
        autoOpenDesc: "Agent 修改文件后自动弹出改动记录"
      },
      en: {
        loading: "Loading change log…",
        empty: "The agent has not written any file in this session.",
        summary: "{files} files · {edits} edits",
        refusedSummary: " · {n} refused",
        shellNote: "{n} shell commands also look like they wrote files, and they are not listed above. A shell result carries no file information, and a guessed path would be a wrong one, so the gap is stated rather than filled in.",
        turn: "Turn {n}",
        edits: "{n} changes",
        refused: "{n} refused",
        refusedHead: "Refused writes",
        before: "Before",
        after: "After",
        created: "Created",
        createdContent: "New content",
        lineRange: "{label} · lines {start}-{end}",
        lineRangeRelative: "{label} (block lines {start}-{end})",
        sensitive: "Sensitive file, content hidden",
        expand: "Expand {n} more lines",
        collapse: "Collapse",
        searchPlaceholder: "Search file path…",
        search: "Search",
        clear: "Clear",
        noResult: "No files match \"{q}\"",
        openInEditor: "Open in editor",
        copy: "Copy",
        copied: "Copied",
        loadFailed: "Failed to load content (session may be closed)",
        autoOpenLabel: "Auto-open on file changes",
        autoOpenDesc: "Open the change log automatically when the agent edits files"
      }
    };

    function langOf(ctx) {
      try {
        var active = ctx.locale && ctx.locale.getSnapshot ? ctx.locale.getSnapshot().active : void 0;
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
      var sessions = ctx.sessions;
      if (sessions === void 0 || typeof sessions.binding !== "function") return void 0;
      var binding = sessions.binding(sessionId);
      if (binding === void 0 || binding.session === void 0) return void 0;
      var projections = binding.session.projections;
      if (projections === void 0 || typeof projections.faceOf !== "function") return void 0;
      return projections.faceOf(KEY);
    }

    // ── 按轮次分组：edits 和 refusals 都按 turn 聚合，turn 降序 ──
    function groupByTurn(files) {
      var map = new Map();
      function ensureFile(tg, path) {
        if (!tg.files.has(path)) tg.files.set(path, { path: path, edits: [], refusals: [] });
        return tg.files.get(path);
      }
      (files || []).forEach(function (file) {
        (file.edits || []).forEach(function (edit) {
          if (!map.has(edit.turn)) map.set(edit.turn, { turn: edit.turn, files: new Map() });
          var tg = map.get(edit.turn);
          ensureFile(tg, file.path).edits.push(edit);
        });
        (file.refusals || []).forEach(function (r) {
          if (!map.has(r.turn)) map.set(r.turn, { turn: r.turn, files: new Map() });
          var tg = map.get(r.turn);
          ensureFile(tg, file.path).refusals.push(r);
        });
      });
      return Array.from(map.values())
        .sort(function (a, b) { return b.turn - a.turn; })
        .map(function (tg) { return { turn: tg.turn, files: Array.from(tg.files.values()) }; });
    }

    // ── 工具名友好化 ──
    function toolLabel(tool) {
      if (tool === "edit") return "编辑 edit";
      if (tool === "write") return "写入 write";
      if (tool === "str_replace_editor") return "编辑器 str_replace_editor";
      if (tool === "bash" || tool === "shell" || tool === "sh") return "shell 命令";
      return tool || "未知工具";
    }

    // ── 单个代码块：带行号、行数上限、复制 ──
    // text: 内容；startLine: 真实起始行号（缺省 1）；isRelative: 是否相对行号；kind: old|new
    function CodeBlock(props) {
      var label = props.label;
      var text = props.text;
      var startLine = props.startLine;
      var isRelative = props.isRelative;
      var kind = props.kind;
      var ctx = props.ctx;
      var onCopy = props.onCopy;
      var expanded = props.expanded;
      var onToggleExpand = props.onToggleExpand;

      var allLines = String(text).split("\n");
      var showAll = expanded || allLines.length <= MAX_BLOCK_LINES;
      var lines = showAll ? allLines : allLines.slice(0, MAX_BLOCK_LINES);
      var start = typeof startLine === "number" && startLine >= 1 ? startLine : 1;
      var end = start + (showAll ? allLines.length : MAX_BLOCK_LINES) - 1;
      var rangeText = isRelative
        ? t(ctx, "lineRangeRelative", { label: label, start: start, end: end })
        : t(ctx, "lineRange", { label: label, start: start, end: end });
      var cls = kind === "old" ? "wc-block wc-old" : "wc-block wc-new";

      return createElement("div", { className: cls },
        createElement("div", { className: "wc-blockLabel" },
          createElement("span", { className: "wc-blockLabelText" }, rangeText),
          createElement("button", { type: "button", className: "wc-copyBtn", onClick: function (e) { e.stopPropagation(); onCopy(text); } },
            t(ctx, "copy")
          )
        ),
        createElement("div", { className: "wc-code" },
          lines.map(function (line, i) {
            return createElement("div", { className: "wc-line", key: i },
              createElement("span", { className: "wc-lineno" }, String(start + i)),
              createElement("span", { className: "wc-codeText" }, line === "" ? "\u00A0" : line)
            );
          }),
          !showAll && createElement("button", { type: "button", className: "wc-expandBtn", onClick: onToggleExpand },
            t(ctx, "expand", { n: allLines.length - MAX_BLOCK_LINES })
          )
        )
      );
    }

    // ── 单处编辑：工具标签 + 懒加载内容 ──
    // 索引化后投影只给 callId，内容按需从 host RPC 取。
    function EditBlocks(props) {
      var edit = props.edit;
      var ctx = props.ctx;
      var sessionId = props.sessionId;
      var expanded = props.expanded;
      var onToggleExpand = props.onToggleExpand;
      var copyState = props.copyState;
      var onCopy = props.onCopy;

      var blocks = [];
      blocks.push(
        createElement("div", { className: "wc-editMeta", key: "meta" },
          createElement("span", { className: "wc-toolTag" }, toolLabel(edit.tool)),
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
        if (content.oldText !== void 0 && content.oldText !== "") {
          blocks.push(createElement(CodeBlock, {
            key: "old",
            label: t(ctx, "before"),
            text: content.oldText,
            startLine: edit.oldStart,
            isRelative: edit.oldStart === void 0,
            kind: "old",
            ctx: ctx,
            onCopy: onCopy,
            expanded: expanded,
            onToggleExpand: onToggleExpand
          }));
        }
        if (content.newText !== void 0 && content.newText !== "") {
          blocks.push(createElement(CodeBlock, {
            key: "new",
            label: edit.kind === "create" ? t(ctx, "createdContent") : t(ctx, "after"),
            text: content.newText,
            startLine: edit.newStart,
            isRelative: edit.newStart === void 0,
            kind: "new",
            ctx: ctx,
            onCopy: onCopy,
            expanded: expanded,
            onToggleExpand: onToggleExpand
          }));
        }
      }
      return createElement("div", { className: "wc-edit" }, blocks);
    }

    // ── 展开态编辑：负责懒加载内容（fetch host RPC） ──
    // loadState: undefined=加载中, null=加载失败, {…}=成功
    function ExpandedEdit(props) {
      var edit = props.edit;
      var ctx = props.ctx;
      var sessionId = props.sessionId;
      var expanded = props.expanded;
      var onToggleExpand = props.onToggleExpand;
      var copyState = props.copyState;
      var onCopy = props.onCopy;
      var filePath = props.filePath;

      var loadState = useState(void 0);
      var loadData = loadState[0];
      var setLoadData = loadState[1];

      useEffect(function () {
        var alive = true;
        if (edit.sensitive) { setLoadData(void 0); return; }
        setLoadData(void 0);
        fetch("/api/what-changed/diff", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: sessionId, callId: edit.callId, path: filePath }),
          cache: "no-store"
        }).then(function (r) { return r.json(); }).then(function (data) {
          if (alive) setLoadData(data && data.ok && data.value ? data.value : null);
        }).catch(function () { if (alive) setLoadData(null); });
        return function () { alive = false; };
      }, [edit.callId, sessionId, edit.sensitive, filePath]);

      return createElement(EditBlocks, {
        edit: edit,
        ctx: ctx,
        sessionId: sessionId,
        content: loadData,
        loadFailed: loadData === null,
        expanded: expanded,
        onToggleExpand: onToggleExpand,
        copyState: copyState,
        onCopy: onCopy
      });
    }

    // ── 单个文件：可折叠，改动 + 被拒写入分开列 ──
    function FileGroup(props) {
      var file = props.file;
      var open = props.open;
      var onToggle = props.onToggle;
      var ctx = props.ctx;
      var sessionId = props.sessionId;
      var editCount = (file.edits || []).length;
      var refusalCount = (file.refusals || []).length;
      var onOpenInEditor = props.onOpenInEditor;

      return createElement("div", { className: "wc-file" },
        createElement("button", {
          type: "button",
          className: "wc-fileHead",
          onClick: onToggle,
          "aria-expanded": open ? "true" : "false"
        },
          createElement("span", { className: "wc-caret" }, open ? "\u25BE" : "\u25B8"),
          createElement("span", { className: "wc-path", title: file.path }, file.path),
          editCount > 0 && createElement("span", { className: "wc-fileCount" }, t(ctx, "edits", { n: editCount })),
          refusalCount > 0 && createElement("span", { className: "wc-refusalCount" }, t(ctx, "refused", { n: refusalCount })),
          createElement("button", {
            type: "button",
            className: "wc-openBtn",
            onClick: function (e) { e.stopPropagation(); onOpenInEditor(file.path); },
            title: t(ctx, "openInEditor")
          }, "\u2197")
        ),
        open && createElement("div", { className: "wc-fileBody" },
          (file.edits || []).map(function (edit, i) {
            return createElement(ExpandedEdit, {
              key: "e" + i,
              edit: edit,
              ctx: ctx,
              sessionId: sessionId,
              filePath: file.path,
              expanded: props.expandedEdits[i],
              onToggleExpand: function () { props.onToggleEditExpand(i); },
              copyState: props.copyState,
              onCopy: props.onCopy
            });
          }),
          (file.refusals || []).length > 0 && createElement("div", { className: "wc-refusals" },
            createElement("div", { className: "wc-refusalsHead" }, t(ctx, "refusedHead")),
            (file.refusals || []).map(function (r, i) {
              return createElement("div", { className: "wc-refusal", key: "r" + i },
                createElement("span", { className: "wc-toolTag" }, toolLabel(r.tool)),
                createElement("span", { className: "wc-refusalReason" }, r.reason)
              );
            })
          )
        )
      );
    }

    // ── 折叠状态容器（localStorage 持久化：sessionId + path 维度） ──
    function CollapsibleFile(props) {
      var file = props.file;
      var defaultOpen = props.defaultOpen;
      var sessionId = props.sessionId;
      var storeKey = "dsw-what-changed:open:" + sessionId + ":" + file.path;

      // 读取持久化的折叠状态（用户手动开关过的优先，否则用默认）
      var readStored = function () {
        try {
          var v = localStorage.getItem(storeKey);
          if (v === null) return defaultOpen;
          return v === "1";
        } catch (e) { return defaultOpen; }
      };

      var openState = useState(readStored);
      var open = openState[0];
      var setOpen = openState[1];
      // 每处编辑的"展开剩余行"状态
      var expandedState = useState({});
      var expandedEdits = expandedState[0];
      var setExpandedEdits = expandedState[1];
      var copyState = useState("");
      var copied = copyState[0];
      var setCopied = copyState[1];

      var toggleOpen = function () {
        var next = !open;
        setOpen(next);
        try { localStorage.setItem(storeKey, next ? "1" : "0"); } catch (e) { /* storage unavailable */ }
      };

      var onCopy = useCallback(function (text) {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { setCopied(t(props.ctx, "copied")); });
          }
        } catch (e) { /* clipboard unavailable */ }
      }, [props.ctx]);

      return createElement(FileGroup, {
        file: file,
        open: open,
        onToggle: toggleOpen,
        ctx: props.ctx,
        sessionId: sessionId,
        onOpenInEditor: props.onOpenInEditor,
        expandedEdits: expandedEdits,
        onToggleEditExpand: function (i) {
          setExpandedEdits(function (prev) {
            var next = Object.assign({}, prev);
            next[i] = !next[i];
            return next;
          });
        },
        copyState: copied,
        onCopy: onCopy
      });
    }

    // ── tab 主体 ──
    function ChangedTab(props) {
      var ctx = props.ctx;
      var sessionId = props.scope ? props.scope.sessionId : void 0;
      var store = props.store;

      var subscribe = useCallback(function (cb) {
        var face = faceOf(ctx, sessionId);
        return face ? face.subscribe(cb) : function () {};
      }, [ctx, sessionId]);

      var getSnapshot = useCallback(function () {
        var face = faceOf(ctx, sessionId);
        return face ? face.getSnapshot() : void 0;
      }, [ctx, sessionId]);

      var data = useSyncExternalStore(subscribe, getSnapshot);

      var searchState = useState("");
      var searchQuery = searchState[0];
      var setSearchQuery = searchState[1];
      // activeQuery：点「搜索」按钮后才生效（输入框内容不即时过滤）
      var activeState = useState("");
      var activeQuery = activeState[0];
      var setActiveQuery = activeState[1];
      // 搜索结果计数（用于"搜索成功"反馈）
      var searching = activeQuery.trim() !== "";

      if (data === void 0) {
        return createElement("div", { className: "wc-empty" }, t(ctx, "loading"));
      }

      var files = data.files || [];
      var totalEdits = data.totalEdits || 0;
      var totalRefused = data.totalRefused || 0;
      var shellWrites = data.shellWrites || 0;

      if (files.length === 0) {
        return createElement("div", { className: "wc-empty" }, t(ctx, "empty"));
      }

      // 搜索过滤（按 activeQuery）
      var filtered = files;
      if (searching) {
        var q = activeQuery.trim().toLowerCase();
        filtered = files.filter(function (f) { return f.path.toLowerCase().includes(q); });
      }

      // useMemo：只在 data 变化时重算分组
      var turns = useMemo(function () { return groupByTurn(filtered); }, [filtered, data]);
      // 最新轮次默认展开
      var latestTurn = turns.length > 0 ? turns[0].turn : void 0;

      var openInEditor = function (path) {
        try {
          ctx.betterSidebar && ctx.betterSidebar.openTab({ type: "editor", path: path }, { sessionId: sessionId });
        } catch (e) { /* editor open failed */ }
      };

      return createElement("div", { className: "wc-tab" },
        createElement("div", { className: "wc-summary" },
          t(ctx, "summary", { files: filtered.length, edits: totalEdits }) + (totalRefused > 0 ? t(ctx, "refusedSummary", { n: totalRefused }) : "")
        ),
        shellWrites > 0 && createElement("div", { className: "wc-note" },
          t(ctx, "shellNote", { n: shellWrites })
        ),
        createElement("div", { className: "wc-searchRow" },
          createElement("input", {
            type: "text",
            className: "wc-search",
            placeholder: t(ctx, "searchPlaceholder"),
            value: searchQuery,
            onChange: function (e) { setSearchQuery(e.target.value); },
            onKeyDown: function (e) { if (e.key === "Enter") setActiveQuery(searchQuery); }
          }),
          createElement("button", {
            type: "button",
            className: "wc-searchBtn",
            onClick: function () { setActiveQuery(searchQuery); }
          }, t(ctx, "search")),
          searching && createElement("button", {
            type: "button",
            className: "wc-searchBtn wc-searchClear",
            onClick: function () { setSearchQuery(""); setActiveQuery(""); }
          }, "✕ " + t(ctx, "clear"))
        ),
        searching && filtered.length === 0 && createElement("div", { className: "wc-empty" },
          t(ctx, "noResult", { q: activeQuery })
        ),
        turns.map(function (tg) {
          return createElement("div", { className: "wc-turn", key: tg.turn },
            createElement("div", { className: "wc-turnHead" }, t(ctx, "turn", { n: tg.turn })),
            tg.files.map(function (f) {
              return createElement(CollapsibleFile, {
                key: tg.turn + ":" + f.path,
                file: f,
                ctx: ctx,
                sessionId: sessionId,
                defaultOpen: tg.turn === latestTurn,
                onOpenInEditor: openInEditor
              });
            })
          );
        })
      );
    }

    var STYLES = [
      ".wc-tab{height:100%;overflow-y:auto;overflow-x:hidden;padding:14px;display:flex;flex-direction:column;gap:12px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,inherit)}",
      ".wc-summary{padding:8px 12px;border-radius:8px;background:var(--dsw-alias-interactive-bg,rgba(97,135,216,.08));color:var(--dsw-alias-label-secondary,inherit);font-size:.85em}",
      ".wc-turn{display:flex;flex-direction:column;gap:8px}",
      ".wc-turnHead{font-weight:600;font-size:.95em;padding:2px 0;border-bottom:1px solid var(--dsw-alias-border-line,rgba(0,0,0,.1))}",
      ".wc-searchRow{display:flex;align-items:center;gap:6px;padding:0}",
      ".wc-search{flex:1 1 auto;min-width:0;padding:6px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-line,rgba(0,0,0,.15));background:transparent;color:inherit;font:inherit;font-size:.85em}",
      ".wc-search:focus{outline:none;border-color:var(--dsw-alias-border-strong,rgba(0,0,0,.3))}",
      ".wc-searchBtn{flex:0 0 auto;padding:5px 12px;border-radius:6px;border:1px solid var(--dsw-alias-border-line,rgba(0,0,0,.15));background:var(--dsw-alias-interactive-bg,rgba(97,135,216,.12));color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:.82em;cursor:pointer}",
      ".wc-searchBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08))}",
      ".wc-searchClear{border-color:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 30%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 8%,transparent);color:var(--dsw-alias-state-danger-primary,#a12020)}",
      ".wc-file{display:flex;flex-direction:column}",
      ".wc-fileHead{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border:0;border-left:2px solid var(--dsw-alias-border-line,rgba(0,0,0,.08));background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}",
      ".wc-fileHead:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}",
      ".wc-caret{flex:0 0 auto;width:12px;color:var(--dsw-alias-label-secondary,inherit)}",
      ".wc-path{font-family:ui-monospace,Menlo,monospace;font-size:.85em;overflow-wrap:anywhere;flex:1 1 auto;color:var(--dsw-alias-label-primary,inherit)}",
      ".wc-fileCount{flex:0 0 auto;font-size:.78em;color:var(--dsw-alias-label-secondary,inherit)}",
      ".wc-refusalCount{flex:0 0 auto;font-size:.78em;font-weight:600;color:var(--dsw-alias-state-danger-primary,#a12020)}",
      ".wc-openBtn{flex:0 0 auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary,inherit);cursor:pointer;font-size:.9em;padding:0 2px}",
      ".wc-openBtn:hover{color:var(--dsw-alias-link,#2f6fed)}",
      ".wc-refusals{margin-top:4px;padding:8px 10px;border-radius:6px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 30%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 8%,transparent)}",
      ".wc-refusalsHead{font-size:.78em;font-weight:600;color:var(--dsw-alias-state-danger-primary,#a12020);margin-bottom:6px}",
      ".wc-refusal{display:flex;align-items:center;gap:6px;padding:2px 0}",
      ".wc-refusalReason{font-size:.8em;color:var(--dsw-alias-state-danger-primary,#a12020);font-family:ui-monospace,Menlo,monospace}",
      ".wc-fileBody{display:flex;flex-direction:column;gap:10px;padding:8px 0 4px 18px}",
      ".wc-edit{display:flex;flex-direction:column;gap:8px}",
      ".wc-editMeta{display:flex;align-items:center;gap:6px}",
      ".wc-toolTag{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;font-size:.75em;font-weight:600;background:var(--dsw-alias-interactive-bg,rgba(97,135,216,.12));color:var(--dsw-alias-label-secondary,inherit);font-family:ui-monospace,Menlo,monospace}",
      ".wc-kindTag{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;font-size:.75em;font-weight:600;background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 15%,transparent);color:var(--dsw-alias-state-success-primary,#1a7f37)}",
      ".wc-loading{color:var(--dsw-alias-label-secondary,inherit);font-size:.8em;padding:4px 8px}",
      ".wc-sensitive{padding:8px 10px;border-radius:6px;font-size:.8em;color:var(--dsw-alias-state-danger-primary,#a12020);background:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 8%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 30%,transparent)}",
      ".wc-block{border-radius:6px;overflow:hidden;border:1px solid transparent}",
      ".wc-blockLabel{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 10px;font-size:.78em;font-weight:600;letter-spacing:.02em}",
      ".wc-blockLabelText{flex:1 1 auto}",
      ".wc-copyBtn{border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:.85em;opacity:.7;padding:0 4px}",
      ".wc-copyBtn:hover{opacity:1}",
      ".wc-code{padding:6px 0;overflow-x:auto;font-family:ui-monospace,Menlo,monospace;font-size:.82em;line-height:1.5}",
      ".wc-line{display:flex;min-width:0}",
      ".wc-lineno{flex:0 0 auto;width:44px;padding-right:10px;text-align:right;color:rgba(128,128,128,.7);user-select:none}",
      ".wc-codeText{flex:1 1 auto;min-width:0;white-space:pre-wrap;word-break:break-word;padding-right:8px}",
      ".wc-expandBtn{border:0;background:transparent;color:var(--dsw-alias-link,#2f6fed);cursor:pointer;font:inherit;font-size:.82em;padding:4px 8px}",
      ".wc-old{background:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 7%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 25%,transparent)}",
      ".wc-old .wc-blockLabel{color:var(--dsw-alias-state-danger-primary,#a12020);background:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 12%,transparent)}",
      ".wc-new{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 7%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 25%,transparent)}",
      ".wc-new .wc-blockLabel{color:var(--dsw-alias-state-success-primary,#1a7f37);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 12%,transparent)}",
      ".wc-empty{margin:8px 4px;font-size:.86em;color:var(--dsw-alias-label-secondary,inherit)}",
      ".wc-note{margin:8px 0;padding:8px 10px;border-radius:6px;font-size:.86em;color:var(--dsw-alias-label-primary,inherit);border:1px solid var(--dsw-alias-state-warn-primary,rgba(0,0,0,.2));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,orange) 10%,transparent)}"
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
          title: "改动记录",
          icon: createElement("span", null, "\u{1F4DD}"),
          order: 60,
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
            pluginToggles: [{
              key: "autoOpen",
              title: function () { return t(ctx, "autoOpenLabel"); },
              desc: function () { return t(ctx, "autoOpenDesc"); },
              type: "switch"
            }]
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
          if (id === void 0) { baseline = 0; return; }
          var binding = sessions.binding(id);
          if (binding === void 0 || binding.session === void 0 || binding.session.projections === void 0) {
            baseline = 0;
            return;
          }
          var face = binding.session.projections.faceOf(KEY);
          if (face === void 0) { baseline = 0; return; }
          var snap = face.getSnapshot();
          baseline = (snap && snap.totalEdits) || 0;
          unsubFace = face.subscribe(function () {
            var cur = face.getSnapshot();
            var n = (cur && cur.totalEdits) || 0;
            // 自动弹出开关：从 better-sidebar prefs 读
            var autoOpen = true;
            try {
              var prefs = storePrefs(ctx);
              autoOpen = prefs === void 0 ? true : prefs;
            } catch (e) { /* default on */ }
            if (n > baseline && autoOpen) {
              baseline = n;
              // 同一轮只弹一次：取最新 edit 的 turn 去重
              var latestTurn = -1;
              var filesArr = (cur && cur.files) || [];
              for (var i = 0; i < filesArr.length; i++) {
                var eds = filesArr[i].edits || [];
                for (var j = 0; j < eds.length; j++) if (eds[j].turn > latestTurn) latestTurn = eds[j].turn;
              }
              if (latestTurn !== lastAutoTurn) {
                lastAutoTurn = latestTurn;
                betterSidebar.openTab({ type: "what-changed-sidebar" }, { sessionId: id });
              }
            } else {
              baseline = n;
            }
          });
        };

        rewire();
        var offList = sessions.list.subscribe(function () {
          var id = sessions.list.getSnapshot().current;
          if (id !== currentId) rewire();
        });

        return function () {
          offList();
          if (unsubFace !== null) unsubFace();
        };
      }, "dsh-what-changed-sidebar: auto-open");
    }

    // 读取 better-sidebar 的自动打开设置（pluginSettings 持久化在 sidebar store 的 prefs 里）
    function storePrefs(ctx) {
      try {
        var service = ctx.get("betterSidebar");
        if (service === void 0 || service.getSnapshot === void 0) return void 0;
        var snap = service.getSnapshot();
        var ps = snap && snap.prefs && snap.prefs.pluginSettings;
        var mine = ps && ps["what-changed-sidebar"];
        return mine === void 0 ? void 0 : mine.autoOpen;
      } catch (e) {
        return void 0;
      }
    }

    exports.inject = ["betterSidebar", "sessions"];
    exports.apply = apply;
    return module.exports;
  }
});
