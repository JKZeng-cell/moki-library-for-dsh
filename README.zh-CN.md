# 资料库 for DSH

[English](README.md) · 简体中文

![MOKI资料库：文件管理、多格式预览与AI协同编辑](docs/media/cover.png)

**给DSH加个资源管理器 让AI生成井然有序**

MOKI 资料库是为 **DeepSeek Harness（DSH）** 开发的社区插件。管理本地文件、文件夹和链接，预览多种格式，选中内容后直接与 DSH 对话协作。

从「找文件」到「看内容、改选区、检查保存」，在一个工作流程里完成。既可以整理项目资料，也可以把文档、表格与当前对话并排打开。

[五组用法演示](docs/usage-demos.zh-CN.md) · [侧边工作区制作 PPT](docs/ppt-side-workspace.zh-CN.md) · [预览与编辑格式支持](docs/formats.zh-CN.md) · [图文素材](docs/social/README.md)

[复制指令，让 DSH 安装](#install-with-dsh) · [下载安装包](https://github.com/JKZeng-cell/moki-library-for-dsh/releases/latest) · [完整使用说明](docs/guide.zh-CN.md) · [功能介绍](docs/features.md) · [反馈与建议](https://github.com/JKZeng-cell/moki-library-for-dsh/issues)

## 能做什么

- **文件统一管理**：映射本地文件和文件夹、创建虚拟目录、标签筛选、快速检索、卡片与列表视图。空目录支持拖拽添加提示。
- **多格式预览**：图片、音视频、PDF、Office、文本、压缩包目录、字体及常见 3D 格式。部分格式有解码和兼容性限制。
- **Office 协同编辑**：Word、Excel、PPT 在隔离草稿中编辑，实时查看修改结果，确认后保存或另存为。
- **选哪里，就协作哪里**：传递文本位置、工作表与单元格范围、幻灯片对象、PDF 页码或画面选区。按 **Alt+D** 唤起 DSH 对话。
- **适应不同工作方式**：主窗口管理、侧边工作区多标签、可跨屏移动的独立预览窗口，也可选择系统默认应用。对话浮窗可拖动、缩放，使用 DSH 原生输入能力。
- **连接对话和任务文件**：可选开启资料库附件选择入口；自动把 DSH 新建或交付的任务文件映射进资料库。
- **精简选区传递**：只传必要的选区正文与准确位置；支持的简单修改通过 `context → edit_selection` 完成，复杂修改按需调用 Office 工具。

![DSH 完整界面：右侧 MOKI 资料库选中文件，左侧对话输入框显示资料库引用与任务要求](docs/media/dsh-workspace.png)

**资料库和会话并排协作。** 本机 DSH Web 完整界面实拍：右侧选中「项目排期.xlsx」与「产品介绍.docx」，点击「选区加入对话」后，左侧原生输入框显示资料库引用，再输入任务要求。画面使用演示文件，输入草稿尚未发送。[查看卡片模式版本](docs/media/dsh-workspace-cards.png)。

![列表与卡片模式，画面使用公开演示数据](docs/media/library.png)

![Excel 选区与 DSH 对话浮窗，使用公开演示界面进行编排](docs/media/editing.png)

协作示意图展示 DSH 浮窗中的 `Sheet1!C2:C6` 引用与待发送的修改要求。[查看原始浮窗截图](docs/media/raw/dsh-floating-chat.png)。

## 安装

已验证环境：**Windows / DSH 桌面版 0.2.2-rc.1**。插件声明兼容 `>=0.2.2-rc.1 <0.3.0`，其他版本和操作系统仍需验证。要求 **Node.js 22.19+**。独立预览窗口需要本机安装 Edge 或 Chrome；FFmpeg 为可选的音视频解码依赖。

<a id="install-with-dsh"></a>

### 方式一：复制整段指令，发送给 DSH

1. 打开 **DSH 桌面端 → 新会话**，选择可用模型，并确保当前会话可以执行本机终端命令。
2. 点击下面代码块右上角的复制按钮，将**整段文字粘贴到 DSH 对话输入框并发送**。它是给 DSH 的任务指令，终端命令见后面的手动安装。

```text
请帮我在当前 DSH 桌面端安装「MOKI资料库」插件，完成下载、安装和版本验证。

仓库：https://github.com/JKZeng-cell/moki-library-for-dsh
版本：0.1.59
安装包：https://github.com/JKZeng-cell/moki-library-for-dsh/releases/download/v0.1.59/dsh-moki-library-0.1.59.tgz
SHA256：e381a5c177143dc5e1917b9bdec4ceb2627f8a503677c80708beea8dd6f0343e

请依次执行：
1. 检查当前系统、DSH 版本和它使用的 Node.js。插件要求 DSH >=0.2.2-rc.1 <0.3.0、Node.js >=22.19，主要验证环境为 Windows 桌面端。
2. 找到当前桌面端对应的 DSH CLI。Windows 优先使用安装目录里的 resources/runtime/cli/bin/dsh.cmd，并沿用当前桌面端的 DSH_HOME（如果有设置）。目标配置为 desktop。
3. 检查 desktop 中已安装的 dsh-moki-library 版本。相同版本已安装时直接验证；已有更新版本时保留它并向我说明。需要安装时，将上述 .tgz 下载到本地并核对 SHA256。
4. 使用实际 CLI 和安装包绝对路径执行以下命令形式；把 <安装包绝对路径> 替换为下载文件的路径，Windows 路径使用 / 分隔：
   dsh plugin --profile desktop add "dsh-moki-library@file:<安装包绝对路径>" --allow-build=sharp
5. 执行版本检查：
   dsh plugin --profile desktop list dsh-moki-library --depth 0
   以命令结果确认安装到 desktop 的版本为 0.1.59（或原有的更新版本）。保留现有插件、配置和资料库数据。
6. 汇报安装包位置、实际使用的 CLI、配置和版本检查结果，再提醒我保存工作、手动完全退出并重新打开 DSH。安装任务进行中请保持当前 DSH 会话运行。

如果当前会话不能下载或执行终端、环境不兼容，或安装失败，请说明具体原因和下一步操作，安装状态以实际命令结果为准。
```

3. 如 DSH 弹出本次下载或终端操作的审批，按界面提示处理；等待它返回安装和版本检查结果。
4. 保存当前工作，**完全退出并重新打开 DSH**。在插件列表中确认「MOKI资料库」已启用，再从侧边栏打开它。
5. 用一个示例文件检查预览；在支持编辑的文件中选中文字或单元格，按 **Alt+D** 验证对话入口。资料库附件选择器和任务文件自动映射可在「资料库设置」中按需开启。

<a id="manual-install"></a>

### 方式二：在终端手动安装

1. 先启动一次 DSH 桌面端完成配置初始化，再完全退出。在 [Release](https://github.com/JKZeng-cell/moki-library-for-dsh/releases/tag/v0.1.59) 下载 `dsh-moki-library-0.1.59.tgz`。
2. 在 PowerShell 中把前两行替换为实际路径，再执行安装。若桌面端使用了自定义 `DSH_HOME`，终端也要沿用同一个值。

```powershell
$mokiDshCli = 'C:\Path\To\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
$mokiArchive = 'C:\Downloads\dsh-moki-library-0.1.59.tgz'
$mokiArchive = (Resolve-Path -LiteralPath $mokiArchive).Path.Replace('\', '/')
& $mokiDshCli plugin --profile desktop add "dsh-moki-library@file:$mokiArchive" --allow-build=sharp
```

3. 安装命令成功后，检查版本，再重新打开 DSH：

```powershell
& $mokiDshCli plugin --profile desktop list dsh-moki-library --depth 0
```

如果 `dsh` 已在 PATH 中且对应当前桌面端，可以用 `dsh` 替代 `& $mokiDshCli`。`--profile desktop` 将插件装入桌面配置；`--allow-build=sharp` 允许图片依赖 `sharp` 的安装构建步骤。首次安装需要联网下载依赖。CLI 参数说明可查阅 [DSH 官方文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cli-help.md#dsh-plugin)。

GitHub 的 Source code 压缩包用于开发；`.tgz` Release 资产是可安装插件。本次发布不依赖 npm 上架。

## 如何与 DSH 协作

### 第一次使用

1. 从 DSH 侧边栏打开「MOKI资料库」，用「添加文件」或拖拽添加文件、文件夹与链接；空目录会显示拖入提示。
2. 用虚拟目录和标签整理资料，通过搜索定位；路径栏可粘贴路径，搜索框支持一键清除。列表便于比较文件，卡片和悬浮缩略图便于浏览素材。
3. 打开文件。默认在主窗口资料库中使用独立预览窗口，在侧边工作区中使用新标签页；也可在设置中指定主窗口、独立窗口或默认应用。
4. 对支持编辑的文件点击「编辑」，选中要讨论或修改的位置。按 **Alt+D**，点击「选区加入对话」，再输入要求。
5. 在文件中检查修改结果，再「保存」或「另存为」。保存前的 AI 修改保留在草稿中；关闭重开文件可核对是否写入。

### 可以照着做的协作示例

| 场景 | 先选择什么 | 示例指令与检查方式 |
| --- | --- | --- |
| Excel 排期 | 工作表中的 `C2:C6` | 「只把所选计划天数都增加 1，其他单元格和样式保持不变。」检查数值后保存并重开 |
| Word / 文本改写 | 一段文字 | 「改得更简洁，保留事实和专有名词，只修改选中段落。」检查上下文与样式 |
| PPT 标题 | 当前页文本框中的标题文字 | 「改为『先检查，再保存』，保留文本框位置和字号。」检查换行与排版 |
| PDF 阅读 | 对应页的一段正文 | 「解释这段内容，注明页码，列出需要进一步核实的条件。」只读分析 |
| 图片 / 扫描页 | 框选画面区域 | 「描述框选区域，无法辨认的文字请明确标注。」需要当前模型支持视觉 |

![图片选区和 PDF 页面预览](docs/media/previews.png)

查看[完整图文演示](docs/usage-demos.zh-CN.md)，包含逐步操作、示例输入、结果检查以及侧边工作区与独立窗口的用法。示例指令是操作参考，不是伪造的 AI 对话记录。

### 选区、附件和任务文件

「选区加入对话」传递当前所选内容和位置；「资料库 → 添加附件」提供选中的文件。后者需要在设置中开启「对话输入框显示资料库」。另一个可选设置「自动映射 DSH 任务文件」会将开启后 DSH 新建或交付的本地文件收纳到「DSH 任务文件」，相同路径只映射一次。

悬浮对话可移动、调整大小、新建会话和切换历史，使用 DSH 原生输入能力。使用独立窗口时，按 Alt+D 可在当前预览内继续协作。

选区上下文默认最多 4,000 字符，加入输入框的引用默认最多 1,000 字符，截断会明确标记，可按需读取更多。编辑引用绑定当前会话与编辑器，十分钟后过期；内容变化或重复使用会拒绝修改。

## 文件预览与编辑格式

| 类别 | 主要格式 | 预览 | 内嵌编辑 |
| --- | --- | --- | --- |
| Word / Excel / PPT | DOCX、XLSX、PPTX | 支持 | 支持，先改草稿再保存 |
| 分隔表格 / 工作区 | CSV、TSV、UNIVER | 支持 | 支持；CSV/TSV 不保留工作簿样式 |
| 文本与代码 | TXT、MD、JSON、HTML、XML、YAML、JS/TS、Python 等 | 支持 | 所列可编辑扩展名且不超过 5 MB |
| 旧版与 Apple Office | DOC、PPT、PAGES、NUMBERS、KEY | 内容提取，兼容性有限 | 不支持，先转换为可编辑格式 |
| 图片与设计稿 | PNG、JPEG、GIF、WebP、SVG、BMP、AVIF、ICO、PSD/PSB、TGA、TIFF | 图片或合并图像 | 不提供图像 / 图层编辑 |
| PDF / OFD / AI | PDF、OFD，含 PDF 兼容数据的 AI | 页面、文字或画面 | 读取分析，不提供原格式编辑 |
| 音视频 | MP4、MOV、MKV、AVI、WebM；MP3、WAV、FLAC、AAC、OGG 等 | 依赖编码，必要时使用 FFmpeg | 不提供剪辑编辑 |
| 3D / 字体 | GLB、glTF、OBJ、STL、PLY、FBX；TTF、OTF、WOFF、WOFF2 | 模型操作 / 字体试览 | 不修改模型或字体源文件 |
| 压缩包 | ZIP/ZIP64、RAR5、7z、TAR、GZ、BZ2、XZ、CAB 等 | 只读目录、搜索、分页 | 不编辑包内文件 |

HEIC/HEIF 取决于解码器；旧版 XLS、宏文档和受密码保护文件不列为已支持的内嵌编辑格式。详细扩展名、附属资源要求、只读格式、大小及兼容性限制见[完整支持表](docs/formats.zh-CN.md)。**可预览不等于可编辑，也不代表所有文件变体都能完全还原。**

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
