# dsh-what-changed-sidebar

**Agent 文件改动记录，作为 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 的一个侧边栏 tab。** 按轮次分组，点开文件名看改前（红）／改后（绿）代码块，文件有编辑时自动弹出（可关闭）。

> 依赖 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（>= 0.12.0，提供 `ctx.betterSidebar` 服务）。未安装 better-sidebar 时本插件静默跳过。

## 功能

- **侧边栏 tab**：注册为 better-sidebar 的「+」菜单里的「改动记录」页，不再是会话顶栏的按钮
- **按轮次分组**：所有改动按「第 N 轮」聚合，一眼看清每一轮 Agent 完整改了什么
- **工具类型区分**：每处编辑标注来源工具（`编辑 edit` / `写入 write` / `编辑器 str_replace_editor`），新建文件单独标「新建」
- **改前红块 / 改后绿块**：GitHub 惯例配色（主题 token 驱动，明暗主题自适应），每行带真实行号（缺失时明确标注"块内相对行号"）
- **懒加载**：投影只存轻量索引（callId + 元数据），全量内容按需从会话日志取回——**投影体积小 90%+，展开才读全量，不占内存**
- **自动弹出**（可配置）：当前会话有新的文件编辑时自动打开，同一轮只弹一次；可在 better-sidebar 设置里关闭
- **tab 角标**：tab 上显示改动总数，无需点开
- **搜索 / 跳转 / 复制**：文件路径搜索、一键在编辑器中打开、代码块一键复制
- **折叠状态持久化**：文件折叠状态按会话 + 路径存 localStorage，刷新不丢
- **诚实的缺口提示**：shell 写入无法定位文件、被拒绝的写入，都单独列出并说明
  ![Uploading image.png…]()


## 安全设计

- **敏感文件防护**：`.env`、`*credential*`、`*secret*`、`*.pem`、`*.key`、`id_rsa*` 等只记录"改过"，内容不存入投影、不渲染（显示「敏感文件，内容已隐藏」）
- **无网络外发**：插件零出站网络请求，只在本机 HTTP 路由内取回会话日志内容
- **懒加载降级**：会话关闭后取不回内容时显示「内容加载失败」，不报错不崩溃

## 原理

数据来自 `sessionProjections`，从会话日志实时重放。投影只存轻量索引（每次编辑的 `callId`、工具、轮次、行号、大小），**全量文本留在会话日志里**；前端展开某处编辑时，通过 host 路由 `/api/what-changed/diff` 按 `callId` 取回完整 diff 渲染。

## 安装

```sh
dsh plugin --profile web add dsh-what-changed-sidebar
```

或按本地路径 / GitHub 仓库安装：

```sh
dsh plugin --profile web add /path/to/dsh-what-changed-sidebar
dsh plugin --profile web add github:<你的用户名>/dsh-what-changed-sidebar
```

装完重启 `dsh web`（host 半投影 + 路由需重启），浏览器硬刷新即可。

## 与 dsh-what-changed 的关系

本插件是 [dsh-what-changed](https://github.com/sjh9714/dsh-what-changed) 的**展示层重做版**：复用它的投影收集思路，把「顶栏按钮 + 弹面板」换成「better-sidebar 侧边栏 tab」，并加入懒加载、安全防护、搜索/跳转/复制等能力。

## License

MIT
