# 发布与收录清单

把 dsh-busy-light 放进 DSH 生态的四个入口，按投入从低到高排列。前两项不需要额外账号。

## 0. 一次性的前置条件

- 仓库公开 ✅（`alain-zhu/dsh-busy-light`）
- 根目录有 `package.json`，且 `lib/index.js` 导出 `apply(ctx)` ✅
- 声明 `dsh.bundle` + `dsh.client.platform` + `engines.dsh` ✅
- README 里有可复制的安装命令 ✅

## 1. 让爬虫认出它是 DSH 插件（免费、最关键）

仓库 **Settings → Topics** 添加：

```
dsh-plugin
deepseek-harness
dsh
plugin
```

`dsh-plugin` 是社区目录（dsh-plugin.org、oh-my-dsh、awesome 雷达）抓取的主信号；没有这个 topic，后面所有收录都不会自动发生。

## 2. dsh-plugin.org 收录

在 https://dsh-plugin.org/submit 用 issue 模板提交，正文直接用下面这份：

```markdown
### Repository
https://github.com/alain-zhu/dsh-busy-light

### One-line value
一眼看清每个会话是运行中、在等你操作还是刚完成，并一点跳到对应会话；子代理以树形挂在父会话下。

### Category
UI & Experience

### Install command
dsh plugin --profile web add dsh-busy-light

### Compatibility
DSH >= 0.1.0-rc.5（Web profile，客户端插件），Node >= 20，Windows / macOS / Linux

### License
MIT

### Screenshots / demo
https://github.com/alain-zhu/dsh-busy-light/blob/main/verify/shot-multi.png

### Notes
只读取会话状态，仅写入页面标题、favicon 和 localStorage；无网络请求、无 cordis 依赖、无构建步骤。
```

站点会先索引（可用 `github:alain-zhu/dsh-busy-light` 安装）；**只有发布到 npm 后才会出现在 DSH 内部的 Plugin Hub**。

## 3. awesome-dsh-plugin PR

仓库 `Anil-matcha/awesome-dsh-plugin`，找到 UI 相关分区，按现有条目格式加一行（列表要求"每个插件声明 `dsh.bundle` 且能 `dsh plugin add`"）：

```markdown
- [dsh-busy-light](https://github.com/alain-zhu/dsh-busy-light) — Draggable tree board of every Session: blue breathing while running, amber when blocked on you, green for unread completions, subagents indented under their parent, tab title/favicon in sync. `dsh plugin --profile web add dsh-busy-light`
```

`AdamPlatin123/awesome-dsh-plugins` 是自动扫描 + 实测的雷达，加了 `dsh-plugin` topic 后会自己发现，无需 PR。

## 4. dsh-market 目录

`dsh-market/dsh-market` 的目录是单文件 `data/plugins.json`，按现有条目格式加一条即可提 PR。

## 5. npm 发布（解锁"一行安装"）

```bash
npm login                      # 一次性，需要 npmjs.com 账号 + 2FA
cd <本仓库>
npm publish --access public
```

发布后：

- 安装命令变成 `dsh plugin --profile web add dsh-busy-light`
- `market/index.json` 的 `source` 可改成 `{ "type": "npm" }`（git 与 npm 两种来源都合法）

## 6. 官方并入 `@deepseek-ai/`（长期）

需要在上游 `deepseek-ai/deepseek-harness` 开 PR：

- 位置：`packages/client/ui-busy-light/`
- 用仓库自带的 `tsdown` 构建（`src/index.ts` + `src/client/index.ts` 双半边），产物 `lib/`
- 补客户端 spec（仓库用 vitest）+ 走 `.agents/notes` 决策记录
- commit 规范与 changeset 按仓库要求

周期长，一般先以社区包运行一段时间、有稳定用户后再提。

## 版本发布流程（每次发版）

1. 改 `package.json` 的 `version` 与 `lib/client.js` 的 `VERSION`
2. `node verify/smoke.mjs && node verify/render.mjs`（有 Chromium 再跑 `verify/browser.mjs`）
3. 更新 `market/index.json`：`dist-tags.latest`、`versions[]`（version / publishTimestamp / source.commit）
4. `npm pack --dry-run` 确认打包内容
5. commit + push；npm 发布后打 tag
