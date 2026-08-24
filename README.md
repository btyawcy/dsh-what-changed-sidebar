# dsh-what-changed-sidebar

**Agent 文件改动记录，作为 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 的一个侧边栏 tab。** 按轮次分组，新的在最上面；点开文件看改前（红）／改后（绿）代码块，有编辑时自动弹出（可关闭）。

> 依赖 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（>= 0.12.0，提供 `ctx.betterSidebar` 服务）。未安装 better-sidebar 时本插件静默跳过，不影响 DSH 启动。

## 功能

- **侧边栏 tab**：注册为 better-sidebar「+」菜单里的「改动记录」页，单实例（重复打开聚焦已有页）
- **新→旧倒序**：轮次降序，同一文件的多处改动也是最新在最上面，不用往下翻
- **修改次序编号**：一个文件在一轮里被改多次时，每处标「第 3/4 次修改」，最新那处加「最新」角标；只改一次的不加标签
- **工具类型区分**：每处编辑标注来源工具（`编辑 edit` / `写入 write` / `编辑器 str_replace_editor`），新建文件另标「新建」
- **改前红块 / 改后绿块**：GitHub 惯例配色（主题 token 驱动，明暗自适应），每行带真实行号；拿不到绝对行号时明确标「块内相对行号」
- **懒加载**：投影只存轻量索引（`callId` + 元数据），全量内容按需从会话日志取回——投影体积小一个量级，展开才读
- **shell 写入按轮次列原文**：被判定为写了文件的 shell 命令落在对应轮次里（文件改动之后），折叠展示 `$ 命令原文`，同轮相同命令合并为 `×N`
- **自动弹出**（可配置）：当前会话有新编辑时自动打开，同一轮只弹一次；在 better-sidebar 设置里可关（默认开）
- **tab 角标**：显示改动总数
- **搜索 / 跳转 / 复制**：按文件路径搜索（点按钮生效，非即时过滤）、一键在编辑器中打开、代码块与命令一键复制
- **被拒写入单列**：被沙箱或权限拒绝的写入单独成组，带原因

## 安全设计

- **敏感文件防护**：`.env`、`*credential*`、`*secret*`、`*.pem`、`*.key`、`id_rsa*`、`.npmrc`、`.netrc` 等只记录"改过"，内容不进投影、不渲染，取回路由同样 403 拒绝
- **命令原文不进投影**：shell 命令可能带 inline 凭据，投影会被 `session-projection-cache` 写盘；插件只存 `callId` 和一个用于同轮去重的短哈希，原文按需从日志读
- **命令级敏感隐藏**：命令确实读写敏感文件时（剥掉 heredoc 正文后按路径形状判断 token）整条隐藏，不去猜哪一段是密钥
- **无网络外发**：零出站请求，只在本机 HTTP 路由内取回会话日志内容
- **纯 JSON 投影状态**：state 不含 `Map`/`Set` 或值为 `undefined` 的键，保证 `session-projection-cache` 的无损 JSON 检查通过（否则整条会话检查点会被拒，连带内置投影一起丢）
- **有界增长**：未完成的 pending 调用与 shell 索引都有上限，长会话不会把检查点写爆

## 原理

数据来自 `sessionProjections`，从会话日志实时重放。投影只存轻量索引（每处编辑的 `callId`、工具、轮次、行号、大小）；前端展开时通过 host 路由 `/api/what-changed/diff` 按 `callId` 取回完整 diff 或命令原文再渲染。

绝对行号来自写入工具在 `tool/result` 里带的 applied diff；某些 `write` 调用不带这份元数据，此时回退到 `tool/call` 参数取内容，行号降级为块内相对行号并在 UI 上标明。

## 安装

```sh
dsh plugin --profile web add dsh-what-changed-sidebar
```

或按本地路径 / GitHub 仓库安装：

```sh
dsh plugin --profile web add /path/to/dsh-what-changed-sidebar
dsh plugin --profile web add github:btyawcy/dsh-what-changed-sidebar
```

装完重启 `dsh web`（host 半边的投影与路由需重启进程），浏览器硬刷新即可。

## 与 dsh-what-changed 的关系

本插件是 [dsh-what-changed](https://github.com/sjh9714/dsh-what-changed) 的**展示层重做版**：复用它的投影收集思路，把「顶栏按钮 + 弹面板」换成「better-sidebar 侧边栏 tab」，并加入倒序与次序编号、懒加载索引化、shell 命令原文、敏感防护、搜索/跳转/复制等能力。

## License

MIT
