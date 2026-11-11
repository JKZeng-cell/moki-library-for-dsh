# Preview and editing format support

[简体中文](formats.zh-CN.md) · [Introduction](../README.md) · [Usage demos](usage-demos.md)

This matrix describes the **v0.1.58 implementation**. Previewing, reproducing the original layout, understanding a selection with AI, and editing the source file are separate capabilities. File contents, codecs and the local environment determine actual compatibility.

## Office and text

| Format | Preview | In-plugin editing | Selection collaboration and limits |
| --- | --- | --- | --- |
| Word `.docx` | Document content and editor view | Supported | Selected text and location; review the draft before saving. Check complex layouts against the original application |
| Excel `.xlsx` | Sheets, values, formulas and editor view | Supported | Sheet/range context; edit values or formulas and inspect the result |
| PowerPoint `.pptx` | Slides and editor view | Supported | Slide, object and text-box selection; not every PowerPoint effect is reproduced |
| `.csv`, `.tsv` | Table | Supported | Save as delimited text; these formats do not retain workbook styling or multiple sheets |
| Univer `.univer` | Native workspace | Supported | Native draft editing; available selection actions depend on the document, sheet or slide unit |
| Legacy `.doc`, `.ppt` | Extracted content | No | Not full-fidelity Office rendering. Convert in the original application to `.docx` / `.pptx` before editing |
| Apple `.pages`, `.numbers`, `.key` | Limited content extraction | No | Not native Apple layout rendering; newer file/package structures may not be fully readable |
| Common text, Markdown, JSON, HTML and source code | Text / corresponding preview | Listed extensions below | Exact text ranges and line/column context; files over 5 MB use read-only paging |
| Additional configuration, subtitle and interchange text | Paged text | Some formats are read-only | Discuss selected content without overwriting a whole file with a partial page |
| Legacy Excel `.xls`, macro-enabled `.xlsm` / `.docm` / `.pptm`, RTF, OpenDocument and password-protected documents | Not listed as supported embedded preview formats | No | Use the default app. Converting formats may lose macros or formatting |

**Editable text extensions:** `txt`, `md`, `markdown`, `log`, `json`, `html`, `htm`, `xml`, `yaml`, `yml`, `js`, `jsx`, `ts`, `tsx`, `css`, `scss`, `less`, `py`, `java`, `c`, `cpp`, `h`, `hpp`, `cs`, `go`, `rs`, `sql`, `sh`, `ps1`. CSV/TSV use the spreadsheet editor.

**Additional read-only text previews:** `jsonl`, `ndjson`, `mjs`, `cjs`, `bat`, `cmd`, `ini`, `conf`, `cfg`, `toml`, `env`, `srt`, `vtt`, `ass`, `ssa`, `lrc`, `po`, `properties`, `url`. Paged decoding supports UTF-8, UTF-16 and GB18030. Text detected from an unknown extension is also read-only. An `.env` file can contain credentials; provide only the non-sensitive content needed for the conversation.

## Images, PDF, media and other formats

These previews support viewing, reading and analysis, without an in-place editor for the corresponding binary format.

| Formats | Preview / reading | Collaboration and limits |
| --- | --- | --- |
| PNG, JPG/JPEG/JPE/JFIF, GIF, WebP, SVG, BMP, AVIF, ICO | Image zoom/pan and hover previews | Selected image region and preview coordinates; no image retouching or SVG source editor |
| PSD, PSB, TGA, TIF/TIFF | Composite image or converted preview | PSD/PSB require a saved composite; no layer editing; some color modes/codecs are unsupported |
| HEIC / HEIF | Conditional image conversion | Depends on the installed decoder build; recognizing the extension does not guarantee decoding |
| Illustrator `.ai` | PDF preview when PDF-compatible data is embedded | No Illustrator path, artboard or layer editing |
| PDF | Page rendering, text selection, region selection | Page number and selected text; scanned regions require model vision or separately configured OCR for text recognition |
| OFD | Paged text, images and tables | Text/region selection; complex paths, stamps and unusual image encodings may differ from the original application |
| MP4, WebM, M4V, MOV, OGV, MKV, AVI | Browser playback or local FFmpeg compatibility conversion | Timestamp and selected frame region; actual codecs matter; no video editing/export workflow |
| MP3, WAV, FLAC, AAC, M4A, OGG, Opus | Browser playback or local FFmpeg | No automatic transcription or waveform editor is implied; analysis depends on DSH's configuration |
| GLB, glTF, OBJ, STL, PLY, FBX | Rotate, zoom and pan a model | Selected view region; OBJ primarily shows geometry. Sidecar assets must be in the same folder/subfolders; some compressed textures are unsupported. No modeling editor |
| TTF, OTF, WOFF, WOFF2 | Sample text and font-size controls | Changes the sample only; does not edit or install the font |
| ZIP/ZIP64/ZIPX, RAR5, 7z, TAR, GZ/TGZ, BZ2, XZ, CAB, CCX, MOKIAPP | Read-only entries, sizes, search and paging | Entry paths and selected entries; no automatic extraction or archive editing. Use the default app for encrypted directories, older RAR or damaged archives |
| MOKI, MOKI-BOARD, MOKI-DATA | Exported content or archive directory | No import execution or complete whiteboard rendering |
| Web links | Embedded page or original website | Websites can disallow embedding or require authentication |
| Missing / misleading extensions | Supported PDF, image, ZIP, PSD or text signatures | Limited to signatures implemented by the detector; otherwise use the default app |

## Size and compatibility

- Mapping and streaming an original file have **no single global size cap**, but disk, memory, browsers and decoders still impose practical limits.
- Conversation attachments have a **32 MB per-file limit**. Attaching a whole file and discussing a selected region are different operations.
- Text over **5 MB** uses read-only paging, so a partial page cannot replace the full file accidentally.
- DOCX/XLSX/PPTX structured previews have a **256 MiB expanded-document budget**. The XLSX preview shows up to **20 sheets, 5,000 rows and 200 columns**; the editor uses a separate loading path with its own practical capacity limits.
- Whole-file 3D, font, OFD and PSD/PSB/TGA decoding paths have a **512 MiB guard**. PSD/TGA also have a roughly **64-million-pixel guard**. Decoder errors or timeouts suggest opening the default application.
- Media fallback needs **FFmpeg installed locally**. It converts for preview without changing the original file.
- Review complex Office layouts, animations, embedded objects and special fonts before saving. Use **Save as** to preserve the source.

This is an implementation support matrix, not a claim that every variant of every format has passed testing. See the [five usage demos](usage-demos.md).
