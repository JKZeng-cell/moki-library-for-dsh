# MOKI Library for DSH

English · [简体中文](README.zh-CN.md)

![MOKI Library — file management, rich previews and AI editing in DeepSeek Harness](docs/media/cover.png)

**Give DSH a file explorer. Keep AI-generated work organized.**

MOKI Library is a community plugin for **DeepSeek Harness (DSH)**. It brings a local file library, multi-format previews and Office editing into the same workspace as your DSH conversations.

Move from finding a file to reading, selecting, editing and saving it in one workflow. Organize a project, then keep its documents and spreadsheets beside the conversation.

[Five usage demos](docs/usage-demos.md) · [Create PPTs in the side workspace](docs/ppt-side-workspace.md) · [Preview and editing format support](docs/formats.md) · [Media kit](docs/social/README.md)

[Copy a prompt to install with DSH](#install-with-dsh) · [Download](https://github.com/JKZeng-cell/moki-library-for-dsh/releases/latest) · [Usage guide (中文)](docs/guide.zh-CN.md) · [Features](docs/features.md) · [Report an issue](https://github.com/JKZeng-cell/moki-library-for-dsh/issues)

## Interface and navigation

Open **Library settings → Interface language** to choose **Follow DSH** (default), **简体中文** or **English**. The choice is saved across restarts and updates open library views immediately, independently of DSH’s own interface language. File names, paths, tags and document contents are preserved. An already-open Office editor keeps its current language until reopened, so unsaved edits are not interrupted.

Start a selection drag in the blank space on either side of the library, or between cards and rows. Name, modified-time and added-time sorting compare all items together, without grouping folders or file formats first. Missing dates appear last.

## What you can do

- **Manage files, folders and links.** Map existing local files, organize virtual folders and tags, search, and switch between list and card views. An empty folder welcomes drag-and-drop imports.
- **Preview without switching apps.** Images, audio/video, PDF, Office, text, archives, fonts and common 3D formats have built-in preview paths. Some formats require conversion or have documented limitations.
- **Edit Word, Excel and PowerPoint.** Work on isolated drafts, see changes in the editor, then save back or save a copy.
- **Collaborate on a precise selection.** Pass text offsets, sheet/range addresses, slide objects, page numbers or a selected image region to DSH. Use **Alt+D** to open the conversation while viewing a document.
- **Choose your workspace.** Use the main library, side-workspace tabs, movable native preview windows, or your system's default app. The floating conversation supports the native DSH input capabilities.
- **Connect files to conversations.** Optionally add a library attachment picker above the composer and automatically map newly created DSH task files.
- **Keep context compact.** Selection references carry bounded content and exact locations. Supported edits use `context → edit_selection`; complex edits can use the Office tools.

![Full DSH interface with MOKI Library beside the conversation and two selected files referenced in the composer](docs/media/dsh-workspace.png)

**Library and conversation in one window.** In this actual local DSH Web capture, “项目排期.xlsx” and “产品介绍.docx” are selected in the side workspace. **Add selection to conversation** places a native reference in the composer, followed by the user's request. The files are demonstration data and the input is an unsent draft. [Card-view alternative](docs/media/dsh-workspace-cards.png).

![Library in list and card views, using public demonstration files](docs/media/library.png)

![Excel selection and DSH floating chat, composed from public demonstration UI captures](docs/media/editing.png)

The collaboration illustration includes the DSH floating composer with a `Sheet1!C2:C6` reference and an unsent request. [Original floating-chat capture](docs/media/raw/dsh-floating-chat.png).

## Install

Tested on **Windows with DSH Desktop 0.2.2-rc.1**. Declared compatibility: `>=0.2.2-rc.1 <0.3.0`; other desktop versions and operating systems need further verification. The plugin requires **Node.js 22.19+**. Native preview windows use a locally installed Edge or Chrome. FFmpeg is optional for additional audio/video decoding.

<a id="install-with-dsh"></a>

### Option 1: Copy this prompt into DSH

1. Open **DSH Desktop → New conversation**, select an available model, and make sure the conversation can run local terminal commands.
2. Use the copy button at the top right of the following block. **Paste the entire prompt into the DSH conversation composer and send it.** This is an agent task; terminal commands are provided in the manual installation option below.

```text
Please install the MOKI Library plugin in my current DSH Desktop, including the download, installation and version verification.

Repository: https://github.com/JKZeng-cell/moki-library-for-dsh
Version: 0.1.66
Package: https://github.com/JKZeng-cell/moki-library-for-dsh/releases/download/v0.1.66/dsh-moki-library-0.1.66.tgz
SHA256 checksum manifest: https://github.com/JKZeng-cell/moki-library-for-dsh/releases/download/v0.1.66/SHA256SUMS.txt

Follow these steps:
1. Check the operating system, DSH version and the Node.js runtime it uses. The plugin requires DSH >=0.2.2-rc.1 <0.3.0 and Node.js >=22.19. Windows Desktop is the primary verified environment.
2. Locate the CLI belonging to this desktop installation. On Windows, prefer resources/runtime/cli/bin/dsh.cmd inside its installation directory. Use the desktop's existing DSH_HOME if one is set. Target the desktop profile.
3. Check the installed dsh-moki-library version in desktop. Verify an existing identical version; retain and report a newer version. If installation is needed, download the .tgz above locally and verify its SHA256.
4. Use the actual CLI and the downloaded archive's absolute path with this command pattern. Replace <absolute-archive-path> with that path, using forward slashes on Windows:
   dsh plugin --profile desktop add "dsh-moki-library@file:<absolute-archive-path>" --allow-build=sharp
5. Check the installed version:
   dsh plugin --profile desktop list dsh-moki-library --depth 0
   Confirm that desktop lists version 0.1.66 (or the newer version retained above). Preserve existing plugins, configuration and library data.
6. Report the archive location, actual CLI, profile and version-check result. Then ask me to save my work, fully quit DSH and reopen it manually. Keep the current DSH conversation running while the installation task is in progress.

If this conversation cannot download files or execute a terminal, the environment is incompatible, or installation fails, explain the specific cause and next step. Report installation status from the actual command results.
```

3. Respond to DSH's prompts for the download or terminal operation, if shown, and wait for its installation and version-check results.
4. Save your work, **fully quit DSH and reopen it**. Confirm that **MOKI Library** is enabled in the plugin list, then open it from the sidebar.
5. Preview a sample file. In a supported editor, select text or cells and press **Alt+D** to check the conversation entry. Enable the library attachment picker or task-file mapping in library settings if needed.

<a id="manual-install"></a>

### Option 2: Install manually in a terminal

1. Open DSH Desktop once to initialize its desktop profile, then fully quit it. Download `dsh-moki-library-0.1.66.tgz` from the [release](https://github.com/JKZeng-cell/moki-library-for-dsh/releases/tag/v0.1.66).
2. In PowerShell, replace the first two paths with the actual CLI and archive paths. If the desktop uses a custom `DSH_HOME`, use the same value in this terminal.

```powershell
$mokiDshCli = 'C:\Path\To\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
$mokiArchive = 'C:\Downloads\dsh-moki-library-0.1.66.tgz'
$mokiArchive = (Resolve-Path -LiteralPath $mokiArchive).Path.Replace('\', '/')
& $mokiDshCli plugin --profile desktop add "dsh-moki-library@file:$mokiArchive" --allow-build=sharp
```

3. After the install command succeeds, check the version, then reopen DSH:

```powershell
& $mokiDshCli plugin --profile desktop list dsh-moki-library --depth 0
```

If `dsh` is on PATH and belongs to the current desktop installation, use it in place of `& $mokiDshCli`. `--profile desktop` targets the desktop profile; `--allow-build=sharp` allows the installation build step for the `sharp` image dependency. Initial installation requires network access for runtime dependencies. See the [official DSH CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cli-help.md#dsh-plugin) for profile command syntax.

The GitHub source archive is for development; the `.tgz` release asset is the built plugin. This release does not require an npm publication.

## Selection collaboration

### Your first workflow

1. Open **MOKI Library** from DSH's sidebar. Use **Add files** or drag files, folders and links into the content area.
2. Organize virtual folders and tags. Search by name, tag or path, clear the search with one click, and switch between list/card views. Hover over a thumbnail for a larger preview.
3. Open a file. By default, the main library uses separate preview windows and the side workspace opens new tabs. Settings can explicitly choose DSH's main window, a separate window or the default app.
4. Select text in preview or edit mode and click the **whale beside the selection**. The selection reference is added to the input, ready for your request. **The side workspace focuses the current main conversation; main-window and standalone previews open a floating DSH conversation.** **Alt+D** and **Add selection to conversation** remain available. The whale also appears at Word/PPT text insertion positions, empty Excel cells and text-editor carets. Clicking an empty PDF page area quotes its page and page-relative position. Empty positions never reuse previously selected text.
5. Review the highlighted AI edits, then choose **Accept** or **Discard edit**. After accepting, **Save** or **Save as** and reopen the file to check persistence.

Text previews, PDF text, the text editor and Office editors support quick selection chat, including file and precise location references. Mouse and keyboard selection work in side workspace tabs and separate preview windows. Quoting preserves your existing draft and never sends it automatically. Use visual region selection for scanned PDFs; selections in the default external application remain managed by that application.

### Review before saving

AI edits to text, Word, Excel and PowerPoint are highlighted. Expand the review bar to see locations and before/after content. Highlights are temporary decorations, never saved document formatting. **Accept confirms the draft; Save writes it to the original file.**

The Office editor stays loaded while AI work is in progress. Progress updates and read-only tool calls preserve the current selection instead of reopening the editor. Incoming changes appear in the existing view; actual pending edits still require review.

You can ask DSH to continue editing before accepting an earlier edit. Each new edit builds on the visible draft and adds a review record. Choose **Accept all**, or **Undo latest edit** repeatedly to step back while retaining earlier pending edits. Selection, copying and AI collaboration remain available; manual input and saving wait until review is resolved. Pending records recover with the draft. If another window changes that draft, cancellation reports the conflict and preserves the current content.

### Practical examples

| Task | Select first | Example prompt and check |
| --- | --- | --- |
| Excel schedule | `C2:C6` on the intended sheet | “Increase each selected planned-day value by 1; preserve other cells and styles.” Inspect, save and reopen |
| Word / text revision | A passage | “Make this more concise, preserving facts and proper names. Change only the selected range.” Check context and styles |
| PowerPoint heading | Highlighted text inside the intended text box | “Replace with ‘Review before saving’; preserve the box position and font size.” Check wrapping and layout |
| PDF reading | Text on the relevant page | “Explain this passage, identify its page and list conditions I should verify.” Read-only analysis |
| Image / scanned page | A selected region | “Describe this region and explicitly mark unreadable text.” Requires a vision-capable model |

![Image-region and PDF previews](docs/media/previews.png)

The [illustrated usage demos](docs/usage-demos.md) include exact steps, sample prompts, expected checks and window/workspace choices. Sample prompts are instructions, not fabricated AI transcripts.

### Selections, attachments and task files

**Add selection to conversation** carries selected content and its location. **Library → Add attachments** supplies selected files, after enabling the library composer button in settings. Separately, **automatic task-file mapping** collects newly created/delivered DSH files in “DSH task files” after it is enabled, deduplicating identical paths.

In the side workspace, the whale, DSH conversation button and Alt+D focus the current main conversation so the file stays beside the chat. Main-window and standalone previews use a floating conversation with DSH's native input, moving/resizing and session creation/switching. A standalone preview keeps its conversation inside that window. Moving back to the side workspace routes quotes to the current main session instead of a previously selected floating history session.

Default context text is bounded to 4,000 characters; composer quotes to 1,000. Truncation is marked. Tools can request more content when needed. Selection references are scoped to the conversation/editor, expire after ten minutes, and reject stale or reused edits.

## Preview and editing formats

| Category | Main formats | Preview | In-plugin editing |
| --- | --- | --- | --- |
| Word / Excel / PowerPoint | DOCX, XLSX, PPTX | Supported | Supported; review the draft before saving |
| Delimited data / workspace | CSV, TSV, UNIVER | Supported | Supported; CSV/TSV do not retain workbook styling |
| Text and code | TXT, MD, JSON, HTML, XML, YAML, JS/TS, Python and more | Supported | Listed editable extensions up to 5 MB |
| Legacy / Apple Office | DOC, PPT, PAGES, NUMBERS, KEY | Limited content extraction | No; convert to an editable format first |
| Images / design files | PNG, JPEG, GIF, WebP, SVG, BMP, AVIF, ICO, PSD/PSB, TGA, TIFF | Image or composite preview | No image/layer editor |
| PDF / OFD / AI | PDF, OFD, PDF-compatible AI | Page, text or region | Reading/analysis, not source-format editing |
| Audio / video | MP4, MOV, MKV, AVI, WebM; MP3, WAV, FLAC, AAC, OGG and more | Codec-dependent, optional FFmpeg | No media editing workflow |
| 3D / fonts | GLB, glTF, OBJ, STL, PLY, FBX; TTF, OTF, WOFF, WOFF2 | Model controls / font samples | No model/font source editing |
| Archives | ZIP/ZIP64, RAR5, 7z, TAR, GZ, BZ2, XZ, CAB and more | Read-only directory/search/paging | No archive-content editing |

HEIC/HEIF depend on decoder availability. Legacy XLS, macro-enabled and password-protected documents are not listed as supported embedded editing formats. See the [full matrix](docs/formats.md) for extensions, sidecar resources, read-only formats and size limits. **Preview support does not imply editing support or complete fidelity for every file variant.**

## Data and limits

The catalog, generated files and editing drafts are stored locally under `DSH_HOME/moki-library` or the user's `.dsh/moki-library` directory. Mapping an existing file keeps its original path. **Content selected for AI collaboration or attached to a conversation is provided to DSH and its configured model/tools.** Local storage is not a promise of offline AI processing.

There is no single size cap for mapped files or streamed original-file previews. Decoder support, available memory and disk space still apply. Conversation attachments have a separate **32 MB** limit. Text over **5 MB** uses read-only paging. Whole-file decoding for selected preview types uses a **512 MiB** guard; Office structured-data previews use a **256 MiB** expanded-data budget. See the [format and size details](docs/guide.zh-CN.md#文件预览与大小).

## Build and test

```sh
npm ci
npm run build
npm test
node scripts/collect-licenses.mjs
npm pack
```

The browser/Office tests use an installed Chrome or Edge. Tests create synthetic temporary files, never the user's library. Tests run serially to avoid competing Office runtimes. `src/` contains the DSH integration, `web/` the embedded UI, and `vendor/moki/` the required MOKI library modules.

## Open source and community

- **MIT** for MOKI's source and the included MOKI modules. Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
- [Contributing](CONTRIBUTING.md) · [Public-release hygiene](docs/public-release.md) · [Media kit](docs/social/README.md).
- Discover DSH extensions through the official [`dsh-plugin` topic](https://github.com/topics/dsh-plugin) and [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Join the [MOKI Library community discussion](https://github.com/deepseek-ai/deepseek-harness/discussions/12941) in **Show Your Plugins!**.

Developed by **JKZeng / MOKI**. Contact: [GitHub Issues](https://github.com/JKZeng-cell/moki-library-for-dsh/issues). This is an independent community plugin, not an official DeepSeek product. The DeepSeek Harness logo identifies the host application and belongs to its respective owner.
