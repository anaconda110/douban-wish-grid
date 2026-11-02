# 豆瓣影视收藏网格

把豆瓣「想看 / 在看 / 看过」收藏页改造成自适应海报网格，自动加载全部分页，并在列表卡片和影视详情页提供快捷状态切换与资源搜索入口。

项目同时构建两种产物：

- **用户脚本**：适用于 Tampermonkey、Violentmonkey 等脚本管理器
- **Chromium 扩展**：适用于 Chrome、Edge 等 Chromium 浏览器，Manifest V3

> 本项目与豆瓣及任何第三方资源搜索站均无关联。资源搜索入口只打开第三方站点的搜索结果页，不托管、不提供、不下载任何影视资源。

## 功能

- 将收藏列表改为随视口宽度变化的海报网格，不再受豆瓣默认 15 条/页布局限制
- 自动读取并追加全部分页，使用有限并发和去重，加载过程中即可逐步浏览
- 每张卡片提供「想看 / 在看 / 看过」快捷按钮，当前状态高亮
- 提交状态时保留已有评分、短评和标签；点击当前状态不会重复提交
- 遇到 HTTP 403 时刷新 `ck` 并最多重试一次
- 每张卡片提供「云易搜 / 狗盘」搜索入口，按主片名打开新标签页
- 影视详情页标题下方同样提供资源搜索入口
- 兼容「我的豆瓣」列表地址与 `/people/<用户名>/...` 列表地址

## 支持页面

```text
https://movie.douban.com/mine?status=wish
https://movie.douban.com/mine?status=do
https://movie.douban.com/mine?status=collect
https://movie.douban.com/people/*/wish*
https://movie.douban.com/people/*/do*
https://movie.douban.com/people/*/collect*
https://movie.douban.com/subject/*
```

脚本只在上述豆瓣影视页面运行。刷新豆瓣页面后功能才会生效。

## 安装

### 方式一：用户脚本（推荐 Firefox 用户）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)。
2. 从项目的 GitHub Releases 下载 `douban-wish-grid.user.js`，或在脚本管理器中新建脚本后粘贴文件内容。
3. 启用脚本并打开受支持的豆瓣页面。

用户脚本只使用标准 DOM、`fetch` 和浏览器表单能力，没有 Tampermonkey 专属 API，因此 Violentmonkey 也可运行。

### 方式二：Chromium 扩展

1. 从 GitHub Releases 下载 `douban-wish-grid-extension.zip` 并解压。
2. 打开 `chrome://extensions/` 或 `edge://extensions/`。
3. 开启「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的 `douban-wish-grid-extension` 目录。
5. 刷新已打开的豆瓣页面。

项目暂未上架 Chrome Web Store；扩展更新后需要在扩展管理页重新加载，并刷新豆瓣页面。

## 本地开发

要求 Node.js 20 或更高版本。

```bash
npm ci
npx playwright install chromium
npm test
```

`npm test` 会依次执行语法检查、构建和 Playwright 模拟回归。测试覆盖三类收藏列表、详情页搜索入口、动态追加卡片、状态切换、失败回滚、403 后刷新 `ck` 重试等路径。

只生成产物：

```bash
npm run build
```

构建结果位于 `dist/`：

```text
dist/
├── douban-wish-grid.user.js
├── douban-wish-grid-extension/
│   ├── content.js
│   └── manifest.json
└── douban-wish-grid-extension.zip
```

`src/douban-wish-grid.user.js` 是唯一功能源码。不要直接修改 `dist/`；版本号由 `package.json` 提供，构建时会同步到用户脚本元数据和扩展清单。

## 项目结构

```text
.
├── src/                  # 用户脚本源码
├── scripts/              # 构建与发布校验
├── tests/                # Playwright 回归测试
├── .github/              # CI、Release、Issue/PR 模板
├── package.json
└── dist/                 # 构建生成，不提交版本库
```

## 发布

1. 修改 `package.json` 中的版本号并更新 `CHANGELOG.md`。
2. 提交改动并推送。
3. 创建与版本一致的 tag，例如 `v1.8.0`：

```bash
git tag v1.8.0
git push origin v1.8.0
```

Release 工作流会重新安装依赖、运行测试、构建产物、生成 `SHA256SUMS`，并创建 GitHub Release。

## 隐私与权限

- 不包含统计、遥测、远程配置或第三方分析 SDK。
- 用户脚本使用 `@grant none`；扩展只向豆瓣影视页面注入内容脚本。
- 状态修改请求直接发往豆瓣；项目作者不接收账号、Cookie、收藏或状态数据。
- 「云易搜 / 狗盘」按钮只会把影片主片名拼入第三方搜索 URL，并在用户点击后打开新标签页。
- Cookie 和状态表单只在当前豆瓣页面内用于完成用户主动点击的状态更新。

## 已知限制

- 豆瓣页面结构或接口变更可能导致脚本失效。
- 自动加载全部页面会产生多次豆瓣请求；项目使用 4 路并发、80 ms 错峰和最大 500 页限制，但仍应避免频繁刷新超大收藏列表。
- 第三方搜索站的可用性、搜索参数和内容不受本项目控制。
- 本地回归使用 Playwright 模拟豆瓣页面和接口，**不代表已使用真实豆瓣账号完成端到端验证**。
- 浏览器扩展为 Chromium Manifest V3 版本；Firefox 建议使用用户脚本。

## 参与贡献

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。提交问题时请移除 Cookie、账号名、收藏列表截图中的个人信息等敏感内容。

## 许可证

[MIT](LICENSE)
