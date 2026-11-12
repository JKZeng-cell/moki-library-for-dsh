import { l as uiText } from '../../../../src/i18n.js';
import type { ResourceLibraryItem } from '../../shared/resource-library-contract.js';

type ResourceIdentity = Pick<ResourceLibraryItem, 'kind' | 'name' | 'target'>;

const formats = {
  pdf: { get label() { return uiText("PDF 文档"); }, tone: 'red', mark: 'PDF' },
  word: { get label() { return uiText("Word 文档"); }, tone: 'blue', mark: 'W' },
  document: { get label() { return uiText("文字文档"); }, tone: 'blue', mark: 'DOC' },
  markdown: { get label() { return uiText("Markdown 文档"); }, tone: 'slate', mark: 'MD' },
  text: { get label() { return uiText("文本文件"); }, tone: 'slate', mark: 'TXT' },
  spreadsheet: { get label() { return uiText("电子表格"); }, tone: 'green', mark: 'X' },
  csv: { get label() { return uiText("数据表格"); }, tone: 'green', mark: 'CSV' },
  presentation: { get label() { return uiText("演示文稿"); }, tone: 'orange', mark: 'P' },
  image: { get label() { return uiText("图片"); }, tone: 'teal' },
  vector: { get label() { return uiText("矢量图"); }, tone: 'orange' },
  video: { get label() { return uiText("视频"); }, tone: 'purple' },
  audio: { get label() { return uiText("音频"); }, tone: 'pink' },
  archive: { get label() { return uiText("压缩包"); }, tone: 'amber' },
  code: { get label() { return uiText("代码文件"); }, tone: 'blue' },
  data: { get label() { return uiText("结构化数据"); }, tone: 'teal' },
  design: { get label() { return uiText("设计源文件"); }, tone: 'pink' },
  font: { get label() { return uiText("字体文件"); }, tone: 'purple' },
  model: { get label() { return uiText("三维模型"); }, tone: 'teal' },
  workspace: { get label() { return uiText("Univer 多组件文件"); }, tone: 'purple' },
  whiteboard: { get label() { return uiText("MOKI 白板"); }, tone: 'purple' },
  folder: { get label() { return uiText("虚拟文件夹"); }, tone: 'amber' },
  localFolder: { get label() { return uiText("本地文件夹"); }, tone: 'amber' },
  link: { get label() { return uiText("网页链接"); }, tone: 'blue' },
  file: { get label() { return uiText("文件"); }, tone: 'slate' },
} as const;

export type ResourceVisualKind = keyof typeof formats;
const extensions = new Map<string, ResourceVisualKind>();
for (const [kind, names] of Object.entries({
  pdf: 'pdf', word: 'doc docx docm dot dotx', document: 'odt rtf pages', markdown: 'md markdown mdx', text: 'txt text log',
  spreadsheet: 'xls xlsx xlsm xlsb ods numbers', csv: 'csv tsv', presentation: 'ppt pptx pptm pps ppsx odp key',
  image: 'jpg jpeg png gif webp bmp avif ico tif tiff heic heif raw cr2 nef dng', vector: 'svg eps ai',
  video: 'mp4 mov avi mkv webm m4v ogv flv wmv mpeg mpg', audio: 'mp3 wav flac aac m4a ogg oga wma opus aiff',
  archive: 'zip rar 7z tar gz bz2 xz tgz zst', code: 'js jsx ts tsx html htm css scss sass less py java cpp c h cs go rs sh bash ps1 bat cmd sql vue svelte php rb swift kt',
  data: 'json jsonl xml yaml yml toml ini db sqlite sqlite3 parquet', design: 'psd psb sketch fig xd indd afdesign afphoto',
  font: 'ttf otf woff woff2', model: 'obj fbx gltf glb blend stl c4d max', workspace: 'univer', whiteboard: 'moki',
})) for (const extension of names.split(' ')) extensions.set(extension, kind as ResourceVisualKind);

function extensionOf(value: string): string {
  const basename = value.split(/[\\/]/u).at(-1) ?? '';
  return basename.match(/\.([a-z0-9]+)$/iu)?.[1]?.toLowerCase() ?? '';
}

/** Presentation only: never changes preview support, file access or stored metadata. */
export function resourceFileVisual(item: ResourceIdentity) {
  let target = item.target ?? '';
  if (item.kind === 'url') {
    try { target = new URL(target).pathname; } catch { target = ''; }
    try { target = decodeURIComponent(target); } catch { /* Keep malformed escaped paths readable. */ }
  }
  const extension = extensionOf(target) || extensionOf(item.name);
  const kind: ResourceVisualKind = item.kind === 'folder' ? 'folder' : item.kind === 'local_folder' ? 'localFolder'
    : extensions.get(extension) ?? (item.kind === 'url' ? 'link' : 'file');
  const format = formats[kind];
  return { kind, ...format, mark: 'mark' in format ? format.mark : undefined, extension,
    description: extension && kind !== 'folder' && kind !== 'localFolder' ? `${format.label} · ${extension.toUpperCase()}` : format.label };
}
