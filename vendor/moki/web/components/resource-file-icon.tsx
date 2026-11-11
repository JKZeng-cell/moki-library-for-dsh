import { Archive, AudioLines, Braces, Box, File, FileCode2, Folder, FolderSymlink, Globe, Grid2X2, Image, Palette, PenTool, PanelsTopLeft, Type, Video } from 'lucide-react';
import type { CSSProperties, ReactNode, DragEventHandler } from 'react';
import type { ResourceLibraryItem } from '../../shared/resource-library-contract.js';
import { resourceFileVisual } from '../lib/resource-file-visual.js';
import './resource-file-icon.css';
import {useResourceHoverPreview} from './resource-hover-preview.js';

const symbols = { image: Image, vector: PenTool, video: Video, audio: AudioLines, archive: Archive,
  code: FileCode2, data: Braces, design: Palette, font: Type, model: Box, workspace: Grid2X2,
  whiteboard: PanelsTopLeft, folder: Folder, localFolder: FolderSymlink, link: Globe, file: File };

export function ResourceFileIcon({ item, previewItem, size = 32, className = '', style, children, draggable, onDragStart, title }: {
  previewItem?: ResourceLibraryItem;
  item: Pick<ResourceLibraryItem, 'kind' | 'name' | 'target'>;
  size?: 32 | 40;
  className?: string;
  style?: CSSProperties | undefined;
  children?: ReactNode;
  draggable?: boolean;
  onDragStart?: DragEventHandler<HTMLSpanElement> | undefined;
  title?: string | undefined;
}) {
  const hover=useResourceHoverPreview(previewItem);
  const visual = resourceFileVisual(item);
  const Symbol = symbols[visual.kind as keyof typeof symbols] ?? File;
  const glyph = visual.mark ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 2.5h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1Z" fill="currentColor" opacity=".13"/>
    <path d="M14 2.5v5h5M6 2.5h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    <text x="12" y="16.8" fill="currentColor" textAnchor="middle" fontSize={visual.mark.length === 1 ? 10 : visual.mark.length === 2 ? 7.5 : 6.5} fontWeight="800" fontFamily="var(--font-ui)">{visual.mark}</text>
  </svg> : <Symbol aria-hidden="true" strokeWidth={1.8}/>;
  return <><span {...hover.handlers} className={`resource-file-icon ${className}`} data-size={size} data-file-kind={visual.kind} data-tone={visual.tone}
    data-thumbnail={children ? 'true' : undefined} style={style} role="img" aria-label={visual.description} title={title ?? visual.description}
    draggable={draggable} onDragStart={event=>{hover.handlers.onDragStart?.();onDragStart?.(event)}}>
    {children ? <>{children}<span className="resource-file-icon-thumbnail-mark">{glyph}</span></> : glyph}
  </span>{hover.bubble}</>;
}
