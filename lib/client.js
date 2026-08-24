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
    var MAX_BLOCK_LINES = 200;

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
        autoOpenDesc: "Agent 修改文件后自动弹出改动记录",
        tabTitle: "改动记录",
        omitted: "… 省略 {n} 行 …",
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
        expandCommand: "展开完整命令"
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
        autoOpenDesc: "Open the change log automatically when the agent edits files",
        tabTitle: "Changes",
        omitted: "… {n} lines omitted …",
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
        expandCommand: "Show full command"
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
      function ensureFile(tg, path) {
        if (!tg.files.has(path)) tg.files.set(path, { path: path, edits: [], refusals: [] });
        return tg.files.get(path);
      }
      (files || []).forEach(function (file) {
        (file.edits || []).forEach(function (edit) {
          ensureFile(ensureTurn(edit.turn), file.path).edits.push(edit);
        });
        (file.refusals || []).forEach(function (r) {
          ensureFile(ensureTurn(r.turn), file.path).refusals.push(r);
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
      // 复制反馈：点击后按钮短暂显示"已复制"
      var copiedState = useState(false);
      var copied = copiedState[0];
      var setCopied = copiedState[1];
      // 定时器句柄：卸载时清理，避免在已卸载组件上 setState
      var timerRef = useRef(0);
      useEffect(function () {
        return function () { if (timerRef.current !== 0) clearTimeout(timerRef.current); };
      }, []);
      var flashCopied = function () {
        setCopied(true);
        if (timerRef.current !== 0) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(function () {
          timerRef.current = 0;
          setCopied(false);
        }, 1500);
      };

      var allLines = useMemo(function () { return String(text === void 0 ? "" : text).split("\n"); }, [text]);
      var overflowing = allLines.length > MAX_BLOCK_LINES;
      var truncated = !expanded && overflowing;
      // 截断时保留头尾（前 60% + 后 40%），中间省略，避免长 diff 只看到开头。
      var lines;
      var headCount;
      if (truncated) {
        headCount = Math.floor(MAX_BLOCK_LINES * 0.6);
        var tailCount = MAX_BLOCK_LINES - headCount;
        lines = allLines.slice(0, headCount).concat(
          [{ __gap: true }],
          allLines.slice(allLines.length - tailCount)
        );
      } else {
        lines = allLines;
        headCount = allLines.length;
      }
      var start = typeof startLine === "number" && startLine >= 1 ? startLine : 1;
      var rangeText = isRelative
        ? t(ctx, "lineRangeRelative", { label: label, start: start, end: start + allLines.length - 1 })
        : t(ctx, "lineRange", { label: label, start: start, end: start + allLines.length - 1 });
      var cls = kind === "old" ? "wc-block wc-old" : "wc-block wc-new";

      return createElement("div", { className: cls },
        createElement("div", { className: "wc-blockLabel" },
          createElement("span", { className: "wc-blockLabelText" }, rangeText),
          createElement("button", {
            type: "button",
            className: "wc-copyBtn",
            onClick: function (e) {
              e.stopPropagation();
              var p = onCopy(text);
              if (p && typeof p.then === "function") {
                p.then(function (ok) { if (ok) flashCopied(); });
              } else {
                flashCopied();
              }
            }
          }, copied ? t(ctx, "copied") : t(ctx, "copy"))
        ),
        createElement("div", { className: "wc-code" },
          lines.map(function (line, i) {
            if (line && line.__gap) {
              return createElement("div", { className: "wc-gap", key: "gap" },
                t(ctx, "omitted", { n: allLines.length - MAX_BLOCK_LINES })
              );
            }
            var realLineNo;
            if (truncated && i > headCount) {
              // 尾部行号：从真实结尾反推。lines.length - i 是"距末尾第几行"（末行=1），
              // 对应 allLines 下标 allLines.length - (lines.length - i)。
              realLineNo = start + allLines.length - (lines.length - i);
            } else {
              realLineNo = start + i;
            }
            return createElement("div", { className: "wc-line", key: i },
              createElement("span", { className: "wc-lineno" }, String(realLineNo)),
              createElement("span", { className: "wc-codeText" }, line === "" ? "\u00A0" : line)
            );
          }),
          truncated && createElement("button", { type: "button", className: "wc-expandBtn", onClick: onToggleExpand },
            t(ctx, "expand", { n: allLines.length - MAX_BLOCK_LINES })
          ),
          // 展开后必须能收回去，否则一处长 diff 展开就再也压不下来。
          overflowing && !truncated && createElement("button", { type: "button", className: "wc-expandBtn", onClick: onToggleExpand },
            t(ctx, "collapse")
          )
        )
      );
    }

    // ── 单处编辑：工具标签 + 懒加载内容 ──
    // 索引化后投影只给 callId，内容按需从 host RPC 取。
    function EditBlocks(props) {
      var edit = props.edit;
      var ctx = props.ctx;
      var expanded = props.expanded;
      var onToggleExpand = props.onToggleExpand;
      var onCopy = props.onCopy;

      var blocks = [];
      // 只改过一次的文件不显示编号：本来就只有一块，"唯一一次修改"是纯噪音。
      // 一轮里改了多次才需要"第几次"这个坐标。
      var numbered = edit.of > 1;
      blocks.push(
        createElement("div", { className: "wc-editMeta", key: "meta" },
          numbered && createElement("span", { className: "wc-seqTag" }, t(ctx, "nthEdit", { seq: edit.seq, of: edit.of })),
          numbered && edit.seq === edit.of && createElement("span", { className: "wc-latestTag" }, t(ctx, "latestEdit")),
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
        expanded: expanded,
        onToggleExpand: onToggleExpand,
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
      // 复制反馈（与代码块一致：成功才闪，卸载时清定时器）
      var copiedState = useState(false);
      var copied = copiedState[0];
      var setCopied = copiedState[1];
      var timerRef = useRef(0);
      useEffect(function () {
        return function () { if (timerRef.current !== 0) clearTimeout(timerRef.current); };
      }, []);
      var flashCopied = function () {
        setCopied(true);
        if (timerRef.current !== 0) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(function () {
          timerRef.current = 0;
          setCopied(false);
        }, 1500);
      };

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
          (file.edits || []).map(function (edit, i) {
            return createElement(ExpandedEdit, {
              key: (edit.callId || "e") + ":" + i,
              edit: edit,
              ctx: ctx,
              sessionId: sessionId,
              filePath: file.path,
              expanded: props.expandedEdits[i],
              onToggleExpand: function () { props.onToggleEditExpand(i); },
              onCopy: props.onCopy
            });
          }),
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

      // 每处编辑的"展开剩余行"状态
      var expandedState = useState({});
      var expandedEdits = expandedState[0];
      var setExpandedEdits = expandedState[1];

      var toggleOpen = useCallback(function () {
        setOpen(function (prev) { return !prev; });
      }, []);

      var onCopy = useCallback(function (text) {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return false; });
          }
          // 降级：execCommand 复制
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
      }, []);

      var onToggleEditExpand = useCallback(function (i) {
        setExpandedEdits(function (prev) {
          var next = Object.assign({}, prev);
          next[i] = !next[i];
          return next;
        });
      }, []);

      return createElement(FileGroup, {
        file: file,
        open: open,
        onToggle: toggleOpen,
        ctx: props.ctx,
        sessionId: sessionId,
        onOpenInEditor: props.onOpenInEditor,
        expandedEdits: expandedEdits,
        onToggleEditExpand: onToggleEditExpand,
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

      var searchState = useState("");
      var searchQuery = searchState[0];
      var setSearchQuery = searchState[1];
      // activeQuery：点「搜索」按钮后才生效（输入框内容不即时过滤）
      var activeState = useState("");
      var activeQuery = activeState[0];
      var setActiveQuery = activeState[1];
      var searching = activeQuery.trim() !== "";

      // 提前计算分组（hooks 必须在所有条件 return 之前，避免 React #310）
      // 这里的 files 用投影原始数据（尚未过滤），groupByTurn 对空数组安全。
      var filesAll = (data && data.files) || [];
      var shellsAll = (data && data.shells) || [];
      var turnsAll = useMemo(function () { return groupByTurn(filesAll, shellsAll); }, [filesAll, shellsAll]);

      // 复制按钮的实现（shell 行用；文件块内的复制由 CollapsibleFile 自己提供）。
      var onCopyText = useCallback(function (text) {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return false; });
          }
        } catch (e) { /* fall through */ }
        return Promise.resolve(false);
      }, []);

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

      // 搜索过滤（按 activeQuery）。搜索只针对文件路径，命中时不展示 shell 组
      // ——shell 记录没有可靠路径，拿它去匹配只会给出错误的"命中"。
      var filtered = files;
      if (searching) {
        var q = activeQuery.trim().toLowerCase();
        filtered = files.filter(function (f) { return f.path.toLowerCase().includes(q); });
      }

      // 摘要里的编辑数必须跟着过滤结果走，否则搜出 1 个文件却报整个会话的编辑数。
      var shownEdits = totalEdits;
      var shownRefused = totalRefused;
      if (searching) {
        shownEdits = 0;
        shownRefused = 0;
        filtered.forEach(function (f) {
          shownEdits += (f.edits || []).length;
          shownRefused += (f.refusals || []).length;
        });
      }

      // 按过滤结果分组
      var turns = searching ? groupByTurn(filtered, []) : turnsAll;
      // 最新轮次默认展开
      var latestTurn = turns.length > 0 ? turns[0].turn : void 0;

      return createElement("div", { className: "wc-tab" },
        createElement("div", { className: "wc-summary" },
          t(ctx, "summary", { files: filtered.length, edits: shownEdits })
            + (shownRefused > 0 ? t(ctx, "refusedSummary", { n: shownRefused }) : "")
            + (!searching && shellWrites > 0 ? t(ctx, "shellSummary", { n: shellWrites }) : "")
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
        })
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
      ".wc-gap{padding:4px 8px;color:var(--dsw-alias-label-secondary,inherit);font-size:.8em;font-style:italic;background:var(--dsw-alias-interactive-bg,rgba(0,0,0,.03))}",
      ".wc-old{background:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 7%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 25%,transparent)}",
      ".wc-old .wc-blockLabel{color:var(--dsw-alias-state-danger-primary,#a12020);background:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#d93025) 12%,transparent)}",
      ".wc-new{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 7%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 25%,transparent)}",
      ".wc-new .wc-blockLabel{color:var(--dsw-alias-state-success-primary,#1a7f37);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 12%,transparent)}",
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
