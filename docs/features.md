# MOKI 资料库功能介绍 / Feature overview

MOKI 资料库把「找到文件 → 预览内容 → 选中位置 → 对话协作 → 检查保存」连接到同一个 DSH 工作流程中。

MOKI Library connects **find → preview → select → collaborate → review and save** inside DeepSeek Harness.

| 场景 / Use case | 功能 / Capability |
| --- | --- |
| 整理项目资料 / Organize a project | 本地文件与文件夹映射、虚拟目录、标签、搜索、卡片和列表 / Local mappings, virtual folders, tags, search, cards and lists |
| 快速看内容 / Inspect content | 图片、音视频、PDF、Office、文本、字体、压缩包目录和常见 3D / Images, media, PDF, Office, text, fonts, archives and common 3D |
| 精确协作 / Collaborate precisely | 传递选中文字和位置、单元格范围、幻灯片对象与画面区域 / Text and offsets, cell ranges, slide objects and visual regions |
| 修改 Office / Edit Office documents | Word、Excel、PPT 隔离草稿，实时显示，保存或另存 / Isolated drafts, live updates, save or save a copy |
| 边看边问 / Discuss while viewing | Alt+D 唤起原生 DSH 对话，浮窗可移动和缩放 / Alt+D opens native DSH chat in a movable, resizable panel |
| 多文件并行 / Work across files | 侧边工作区多标签、独立预览窗口、跨屏查看 / Side-workspace tabs and separate preview windows |
| 接入对话 / Attach library items | 可选开启附件选择器和任务文件自动映射 / Optional attachment picker and automatic task-file mapping |

## 产品边界 / Product boundaries

预览格式的能力不同，读取不代表所有格式都可原位编辑。图片、PDF 等可把文字或画面选区交给 AI 理解；Word、Excel、PPT 和支持的文本可进入编辑流程。先查看草稿结果，再保存到源文件。

Preview and editing support differ by format. Image/PDF regions can be provided for AI understanding; supported text and Office documents can be edited. Review the draft before writing back to the source file.

文件保存在本地，但加入 AI 对话的内容会交给 DSH 配置的模型和工具。Windows 已验证；其他平台、特殊格式与大型文件请以实际环境和使用说明为准。

Files are stored locally, while content supplied to AI is processed through DSH's configured model/tools. Windows is verified; other platforms and unusual or large files require validation in the target environment.
