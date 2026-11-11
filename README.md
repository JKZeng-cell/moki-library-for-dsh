# MOKI Library for DSH

English · [简体中文](README.zh-CN.md)

![MOKI Library — file management, rich previews and AI editing in DeepSeek Harness](docs/media/cover.png)

**Keep your files organized. Preview them in place. Collaborate with AI on the exact selection.**

MOKI Library is a community plugin for **DeepSeek Harness (DSH)**. It brings a local file library, multi-format previews and Office editing into the same workspace as your DSH conversations.

[Download](https://github.com/JKZeng-cell/moki-library-for-dsh/releases/latest) · [Usage guide (中文)](docs/guide.zh-CN.md) · [Features](docs/features.md) · [Report an issue](https://github.com/JKZeng-cell/moki-library-for-dsh/issues)

## What you can do

- **Manage files, folders and links.** Map existing local files, organize virtual folders and tags, search, and switch between list and card views. An empty folder welcomes drag-and-drop imports.
- **Preview without switching apps.** Images, audio/video, PDF, Office, text, archives, fonts and common 3D formats have built-in preview paths. Some formats require conversion or have documented limitations.
- **Edit Word, Excel and PowerPoint.** Work on isolated drafts, see changes in the editor, then save back or save a copy.
- **Collaborate on a precise selection.** Pass text offsets, sheet/range addresses, slide objects, page numbers or a selected image region to DSH. Use **Alt+D** to open the conversation while viewing a document.
- **Choose your workspace.** Use the main library, side-workspace tabs, movable native preview windows, or your system's default app. The floating conversation supports the native DSH input capabilities.
- **Connect files to conversations.** Optionally add a library attachment picker above the composer and automatically map newly created DSH task files.
- **Keep context compact.** Selection references carry bounded content and exact locations. Supported edits use `context → edit_selection`; complex edits can use the Office tools.

![Library in list and card views, using public demonstration files](docs/media/library.png)

![Selection collaboration and editing, using public demonstration files](docs/media/editing.png)

## Install

Tested on **Windows with DSH Desktop 0.2.2-rc.1**. Declared compatibility: `>=0.2.2-rc.1 <0.3.0`; other desktop versions and operating systems need further verification. The plugin requires **Node.js 22.19+**. Native preview windows use a locally installed Edge or Chrome. FFmpeg is optional for additional audio/video decoding.

1. Open DSH Desktop once to initialize its desktop profile, then fully quit it. Download `dsh-moki-library-0.1.58.tgz` from the [release](https://github.com/JKZeng-cell/moki-library-for-dsh/releases/tag/v0.1.58).
2. Use the DSH CLI from the desktop installation, replacing the path below with your downloaded archive's absolute path:

```powershell
dsh plugin --profile desktop add 'dsh-moki-library@file:C:/Downloads/dsh-moki-library-0.1.58.tgz' --allow-build=sharp
```

On Windows, the bundled command is `<DSH install directory>/resources/runtime/cli/bin/dsh.cmd`. First installation downloads the runtime dependencies. Restart DSH if the plugin manager requests it.

The GitHub source archive is for development; the `.tgz` release asset is the built plugin. This release does not require an npm publication.

## Selection collaboration

1. Open a file, enter editing mode where supported, and select the text, cells or region you want to discuss.
2. Press **Alt+D**. Use **Add selection to conversation** to include the reference in your draft and describe the change.
3. Inspect the result in the document. Save when it is ready; changes remain in an isolated draft until saved.

Example requests: “Read the selected cells and explain the formula”, “Rewrite this paragraph while keeping its meaning”, or “Describe the selected area of this image”. Visual analysis does not imply that a binary image or PDF can be edited in place.

Default context text is bounded to 4,000 characters; composer quotes to 1,000. Truncation is marked. Tools can request more content when needed. Selection references are scoped to the conversation/editor, expire after ten minutes, and reject stale or reused edits.

## Data and limits

The catalog, generated files and editing drafts are stored locally under `DSH_HOME/moki-library` or the user's `.dsh/moki-library` directory. Mapping an existing file keeps its original path. **Content selected for AI collaboration or attached to a conversation is provided to DSH and its configured model/tools.** Local storage is not a promise of offline AI processing.

There is no single size cap for mapped files or streamed original-file previews. Decoder support, available memory and disk space still apply. Conversation attachments have a separate **32 MB** limit. Text over **5 MB** uses read-only paging. Whole-file decoding for selected preview types uses a **512 MiB** guard; Office structured-data previews use a **256 MiB** expanded-data budget. See the [format and size details](docs/guide.zh-CN.md#文件预览与大小).

## Build and test

```sh
npm ci
npm run build
npm test
node scripts/collect-licenses.mjs
npm pack --pack-destination artifacts
```

The browser/Office tests use an installed Chrome or Edge. Tests create synthetic temporary files, never the user's library. Tests run serially to avoid competing Office runtimes. `src/` contains the DSH integration, `web/` the embedded UI, and `vendor/moki/` the required MOKI library modules.

## Open source and community

- **MIT** for MOKI's source and the included MOKI modules. Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
- [Contributing](CONTRIBUTING.md) · [Public-release hygiene](docs/public-release.md) · [Media kit](docs/social/README.md).
- Discover DSH extensions through the official [`dsh-plugin` topic](https://github.com/topics/dsh-plugin) and [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).

Developed by **JKZeng / MOKI**. Contact: [GitHub Issues](https://github.com/JKZeng-cell/moki-library-for-dsh/issues). This is an independent community plugin, not an official DeepSeek product. The DeepSeek Harness logo identifies the host application and belongs to its respective owner.
