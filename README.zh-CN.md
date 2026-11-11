# MOKI 资料库 for DSH

[English](README.md) · 简体中文

![MOKI资料库：文件管理、多格式预览与AI协同编辑](docs/media/cover.png)

**把文件管理、内容预览和 AI 协同编辑，放进同一个 DSH 工作区。**

MOKI 资料库是为 **DeepSeek Harness（DSH）** 开发的社区插件。管理本地文件、文件夹和链接，预览多种格式，选中内容后直接与 DSH 对话协作。

[下载安装包](https://github.com/JKZeng-cell/moki-library-for-dsh/releases/latest) · [完整使用说明](docs/guide.zh-CN.md) · [功能介绍](docs/features.md) · [反馈与建议](https://github.com/JKZeng-cell/moki-library-for-dsh/issues)

## 能做什么

- **文件统一管理**：映射本地文件和文件夹、创建虚拟目录、标签筛选、快速检索、卡片与列表视图。空目录支持拖拽添加提示。
- **多格式预览**：图片、音视频、PDF、Office、文本、压缩包目录、字体及常见 3D 格式。部分格式有解码和兼容性限制。
- **Office 协同编辑**：Word、Excel、PPT 在隔离草稿中编辑，实时查看修改结果，确认后保存或另存为。
- **选哪里，就协作哪里**：传递文本位置、工作表与单元格范围、幻灯片对象、PDF 页码或画面选区。按 **Alt+D** 唤起 DSH 对话。
- **适应不同工作方式**：主窗口管理、侧边工作区多标签、可跨屏移动的独立预览窗口，也可选择系统默认应用。对话浮窗可拖动、缩放，使用 DSH 原生输入能力。
- **连接对话和任务文件**：可选开启资料库附件选择入口；自动把 DSH 新建或交付的任务文件映射进资料库。
- **精简选区传递**：只传必要的选区正文与准确位置；支持的简单修改通过 `context → edit_selection` 完成，复杂修改按需调用 Office 工具。

![列表与卡片模式，画面使用公开演示数据](docs/media/library.png)

![选区与编辑演示，画面使用公开演示数据](docs/media/editing.png)

## 安装

已验证环境：**Windows / DSH 桌面版 0.2.2-rc.1**。插件声明兼容 `>=0.2.2-rc.1 <0.3.0`，其他版本和操作系统仍需验证。要求 **Node.js 22.19+**。独立预览窗口需要本机安装 Edge 或 Chrome；FFmpeg 为可选的音视频解码依赖。

1. 先启动一次 DSH 桌面端完成配置初始化，再完全退出。在 [Release](https://github.com/JKZeng-cell/moki-library-for-dsh/releases/tag/v0.1.58) 下载 `dsh-moki-library-0.1.58.tgz`。
2. 使用 DSH 桌面端附带的 CLI，将下方路径改为安装包的实际绝对路径：

```powershell
dsh plugin --profile desktop add 'dsh-moki-library@file:C:/Downloads/dsh-moki-library-0.1.58.tgz' --allow-build=sharp
```

Windows 的 CLI 位于 DSH 安装目录中的 `resources/runtime/cli/bin/dsh.cmd`。首次安装需要下载依赖，若插件管理器提示重启，请按提示重新打开 DSH。

GitHub 的 Source code 压缩包用于开发；`.tgz` Release 资产是可安装插件。本次发布不依赖 npm 上架。

## 如何与 DSH 协作

1. 打开文件，在支持的格式中进入编辑，选中文字、单元格或画面区域。
2. 按 **Alt+D**，点击「选区加入对话」，输入具体要求。
3. 在文件里检查修改结果，满意后保存。未保存的修改保留在隔离草稿中。

例如：「解释选中单元格的公式」「把这段话改得简洁一些」「识别图片中框选的区域」。读取和视觉分析能力，不等同于直接编辑图片、PDF 等二进制原文件。

选区上下文默认最多 4,000 字符，加入输入框的引用默认最多 1,000 字符，截断会明确标记，可按需读取更多。编辑引用绑定当前会话与编辑器，十分钟后过期；内容变化或重复使用会拒绝修改。

## 数据与边界

目录索引、生成文件与草稿保存在本机 `DSH_HOME/moki-library` 或用户目录的 `.dsh/moki-library` 中。映射文件继续指向原路径。**加入对话的附件或选区会交给 DSH 及其配置的模型、工具处理**，本地存储不代表 AI 处理完全离线。

映射和流式原文件预览没有统一大小上限，但仍受解码器、内存和磁盘空间约束。对话附件单独限制为 **32 MB**；超过 **5 MB** 的文本使用只读分页；部分整体解码格式有 **512 MiB** 内存保护；Office 结构化预览的展开数据预算为 **256 MiB**。详见[格式与大小说明](docs/guide.zh-CN.md#文件预览与大小)。

## 开发

```sh
npm ci
npm run build
npm test
node scripts/collect-licenses.mjs
npm pack
```

浏览器与 Office 测试需要本机 Chrome 或 Edge，使用临时生成的示例文件，串行执行以避免 Office 运行时竞争。DSH 适配在 `src/`，嵌入界面在 `web/`，资料库所需的 MOKI 模块在 `vendor/moki/`。

## 开源与社区

MOKI 代码采用 [MIT](LICENSE) 许可，第三方依赖保留各自许可，见[第三方声明](THIRD_PARTY_NOTICES.md)。欢迎通过 [Issues](https://github.com/JKZeng-cell/moki-library-for-dsh/issues) 反馈问题和需求，也欢迎提交改进。

[参与贡献](CONTRIBUTING.md) · [公开版本净化说明](docs/public-release.md) · [图文素材包](docs/social/README.md) · [DSH 插件社区](https://github.com/topics/dsh-plugin)

已加入官方 **Show Your Plugins!** 分区：[MOKI 资料库社区讨论](https://github.com/deepseek-ai/deepseek-harness/discussions/12941)。

开发者：**JKZeng / MOKI**。本项目是独立社区插件，不是 DeepSeek 官方产品。图中的 DeepSeek Harness 标志用于标识宿主应用，其商标权属于相应权利人。
