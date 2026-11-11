import { CheckCircle2 } from 'lucide-react';
import type { ResourceLibraryItem } from '../../shared/resource-library-contract.js';
import { ResourceFileIcon } from './resource-file-icon.js';
import { resourceFileVisual } from '../lib/resource-file-visual.js';
import './resource-library-picker.css';

/** Shared row visuals for attachment and access-scope pickers; selection stays with each caller. */
export function ResourceLibraryPickerItemContent({ item }: { item: ResourceLibraryItem }) {
  const kind = resourceFileVisual(item).label;
  return <>
    <ResourceFileIcon item={item}/>
    <span className="library-picker-item-copy">
      <b title={item.name}>{item.name}</b>
      <small title={item.target ?? undefined}>{kind}</small>
    </span>
  </>;
}

export function ResourceLibraryPickerSelectionMark({ selected }: { selected: boolean }) {
  return selected ? <CheckCircle2 className="library-picker-selection-mark" size={16} aria-hidden="true"/>
    : <span className="library-picker-selection-mark" data-empty="true" aria-hidden="true"/>;
}
