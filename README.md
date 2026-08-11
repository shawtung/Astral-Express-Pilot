# Astral-Express-Pilot

《崩坏：星穹铁道》云游戏的自动刷取工具，目前实现「货币战争」模块：反复开局，直到开出你指定的
投资环境或第一位面投资策略为止。

整套流程不读写游戏内存、不注入进程，只是驱动一个真实的 Chrome 打开云游戏网页，靠 OCR 识别画面
文字来判断当前在哪个界面，再按坐标点击。

> [!WARNING]
> 米哈游用户协议禁止使用第三方自动化工具，使用本项目存在账号风险，请自行判断并承担后果。
> 本项目仅供个人学习研究，请勿分发。

## 它怎么工作

```
Electron 主进程 ──── IPC ────> React 渲染进程（配置 / 日志）
      │
      └── Playwright ──> 系统 Chrome ──> 云游戏网页
                              │
                              └── 截图 ──> PP-OCRv4 中文 OCR ──> 判断当前界面
```

每局的循环大致是：进入活动页 → 开始一局 → 读出投资环境和投资策略 → 比对目标 → 命中就停下并
关闭标签页，没命中就放弃本局重开。界面判定全部基于固定 ROI 区域的文字锚点，坐标写在
`src/modules/currency-war/screens.ts`，按 1920×1080 的流画面空间标定。

## 环境要求

- Node.js 22+、pnpm 10+
- **Google Chrome**：Playwright 以 `channel: 'chrome'` 调用系统 Chrome，不额外下载浏览器
- 游戏内设置为**简体中文**（OCR 模型只认简中）、开启**沿用自动战斗设置**且**自动战斗**已打开

首次使用请先用有头模式登录一次，详细步骤见 App 内的「使用指南」。

## 开发

```sh
pnpm install
pnpm dev          # 启动 Electron（渲染进程 HMR，端口 65173）
pnpm check-types  # tsc --noEmit
```

修改 `app/preload/` 后必须重启 Electron，预加载脚本不参与 HMR。

## 打包

```sh
pnpm dist       # 产出安装包到 release/
pnpm dist-dir   # 只打目录，不产出安装包，调试打包结果时用
```

macOS 产出未签名的 arm64 dmg，Windows 为 NSIS 安装包。打包配置见 `electron-builder.yml`。

两处和原生模块相关的坑已经处理好：

- **OCR 模型**通过 `extraResources` 放到 asar 外，主进程用 `MODELS_DIR` 环境变量告知路径。
  onnxruntime 是原生 C++ 代码，读不了 asar 内部。
- **原生插件**（onnxruntime-node、sharp）通过 `asarUnpack` 解包；`tools/after-pack.cjs` 会
  删掉其它平台的预编译二进制，否则单个 ORT 包会带上三个平台的产物。

## 数据目录

登录状态和运行截图都存在这里，删掉等于退出登录。开发版、打包版和命令行工具共用同一个目录，登录一次三边通用：

| 平台 | 路径 |
| --- | --- |
| macOS | `~/Library/Application Support/astral-express-pilot` |
| Windows | `%APPDATA%\astral-express-pilot` |
| Linux | `$XDG_CONFIG_HOME/astral-express-pilot`，未设置时为 `~/.config/astral-express-pilot` |

```
ChromeProfile/                    云游戏登录态（切勿提交或分享）
Screenshots/                      停止时的现场截图
AppSession/                       App 窗口自己的 Electron 会话数据
```

Electron 从自己的 `userData` 取这个路径，命令行则按平台规则自行拼出同一个位置，两边都可以用 `APP_DIR`
覆盖。唯一的例外是截图：命令行运行时截图落在项目根的 `captures/`，方便抓完直接看。

## 命令行工具

`src/` 下的机器人逻辑不依赖 Electron，可以单独跑，调试界面坐标时比开 App 快得多。

```sh
pnpm codex [关键词]        # 查环境 / 策略图鉴
pnpm validate [模块] [配置] # 校验 targets.json
pnpm run-bot              # 跑一次完整刷取
pnpm probe                # 打印播放器在页面中的位置
pnpm grab [名称] [x y w h] # 截图存到 captures/
pnpm ocr <x> <y> <w> <h>   # 对实时画面的指定区域做 OCR
pnpm ocr-file <png>        # 对已有图片做 OCR
pnpm click <x> <y>         # 在游戏画面坐标上点击
pnpm drag <x1> <y1> <x2> <y2>
```

坐标一律使用 1920×1080 的游戏画面空间，与窗口实际大小无关。

环境变量：

| 变量 | 作用 |
| --- | --- |
| `HEADLESS=1` | 无头运行，自行冷启动进入活动页 |
| `KEEP_BROWSER=1` | 跑完不关浏览器，方便排查现场 |
| `APP_DIR` | 覆盖数据目录 |
| `MODELS_DIR` | 覆盖 OCR 模型目录，打包后由主进程设置 |

`targets.json` 是命令行模式的目标配置，App 的配置独立存在 localStorage：

```json
{
  "mode": "overclock",
  "combine": "or",
  "smartEnvironment": true,
  "plane": 1,
  "environments": ["彩虹时代", "银·金·彩"],
  "strategies": ["飞光·映月"]
}
```

## 目录结构

```
src/core/      浏览器、截图、OCR、输入、取消上下文等底层能力
src/modules/   游戏模块，每个模块实现 src/module.ts 的契约
app/main/      Electron 主进程与 IPC
app/renderer/  React 界面
tools/         调试脚本与打包钩子
```

新增模块只需实现 `GameModule` 接口并注册到 `src/modules/index.ts`，界面和命令行会自动识别。

## 已知限制

- 界面坐标按游戏 **V4.4** 标定，版本更新后可能失效，表现为日志报「等待 xxx 超时」
- 仅支持第一位面的投资策略
- 云游戏挂机同样消耗时长，长时间无操作会被踢回首页
- 有头模式运行时不要操作游戏窗口，手动输入会和自动操作冲突
