# 贡献指南

感谢参与改进豆瓣影视收藏网格。

## 开发环境

- Node.js 20+
- npm 10+
- Git Bash、PowerShell、zsh 等任一常用终端均可

```bash
npm ci
npx playwright install chromium
npm test
```

## 修改原则

- 只修改 `src/douban-wish-grid.user.js` 中的功能源码，不要手工修改 `dist/`。
- 保持用户脚本和 Chromium 扩展共用同一套运行逻辑。
- 不引入 `@grant`、远程脚本、遥测或不必要的第三方运行时。
- 尊重豆瓣页面的限速；不要移除并发上限或加入无界请求。
- 新增页面支持时，同时补充元数据 `@match`、测试和 README。
- 涉及账号状态写入的改动必须补充失败回滚、重复点击和请求格式测试。

## 提交前检查

```bash
npm test
```

请确保：

- 语法检查和 Playwright 回归全部通过；
- 构建后的 `dist/douban-wish-grid.user.js` 能正常生成；
- 扩展 ZIP 可以解压且包含 `manifest.json`、`content.js`；
- 没有提交 `node_modules/`、`dist/`、Cookie、账号信息或真实收藏数据。

## Pull Request

请在 PR 中说明：

1. 解决的问题；
2. 主要改动；
3. 执行过的测试；
4. 是否影响真实豆瓣接口或需要真实账号验证。

## 行为准则

参与项目即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
