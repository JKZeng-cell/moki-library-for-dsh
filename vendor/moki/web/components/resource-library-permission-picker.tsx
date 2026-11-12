import { l as uiText } from '../../../../src/i18n.js';
import { RequestErrorNotice } from './request-error-notice.js';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { ResourceLibraryItem } from '../../shared/resource-library-contract.js';
import type { ResourceLibraryPickerDialogProps } from './resource-library-picker-dialog.js';
import { SettingsDialog } from './settings/settings-dialog.js';
import { Button, IconButton, Input } from './ui-controls.js';
import { ResourceLibraryPickerItemContent, ResourceLibraryPickerSelectionMark } from './resource-library-picker-parts.js';
import './resource-library-permission-picker.css';

export function ResourceLibraryPermissionPicker({ items, loading, error, title=uiText("选择资料库访问范围"), description, parentTitle,
  initialSelectedIds=[], maxSelected=500, allowEmpty=true, confirmLabel=uiText("确认选择"), onConfirm, onClose, onRetry,
}: ResourceLibraryPickerDialogProps) {
  const [query,setQuery]=useState(''), [selected,setSelected]=useState(()=>new Set(initialSelectedIds));
  const [expanded,setExpanded]=useState(new Set<string>()), [limit,setLimit]=useState(160), [onlySelected,setOnlySelected]=useState(false);
  const [busy,setBusy]=useState(false), [failure,setFailure]=useState('');
  const byId=useMemo(()=>new Map(items.map(item=>[item.id,item])),[items]);
  const rows=useMemo(()=>{
    const children=new Map<string|null,ResourceLibraryItem[]>(), visible=new Set<string>(), text=query.trim().toLowerCase();
    for(const item of items){
      const parent=item.parentId&&byId.has(item.parentId)?item.parentId:null;
      const siblings=children.get(parent)??[];siblings.push(item);children.set(parent,siblings);
      if((!onlySelected||selected.has(item.id))&&(!text||`${item.name} ${item.target??''} ${item.tags.join(' ')}`.toLowerCase().includes(text))){
        let current:ResourceLibraryItem|undefined=item;
        while(current&&!visible.has(current.id)){visible.add(current.id);current=current.parentId?byId.get(current.parentId):undefined;}
      }
    }
    const output:Array<{item:ResourceLibraryItem;depth:number;open:boolean}>=[],seen=new Set<string>();
    const stack=(children.get(null)??[]).toReversed().map(item=>({item,depth:0}));
    while(stack.length){const {item,depth}=stack.pop()!;if(seen.has(item.id)||!visible.has(item.id))continue;seen.add(item.id);
      const open=expanded.has(item.id)||Boolean(text)||onlySelected;output.push({item,depth,open});
      if(open)for(const child of (children.get(item.id)??[]).toReversed())stack.push({item:child,depth:depth+1});
    }
    return output;
  },[items,byId,query,onlySelected,selected,expanded]);
  const validSelected=[...selected].filter(id=>byId.has(id));
  const toggle=(id:string)=>setSelected(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else if(next.size<maxSelected)next.add(id);return next;});
  const confirm=async()=>{setBusy(true);setFailure('');try{await onConfirm(validSelected.map(id=>byId.get(id)!));}catch(reason){setFailure(reason instanceof Error?reason.message:uiText("选择失败，请重试"));}finally{setBusy(false);}};
  return <SettingsDialog title={title} {...(parentTitle?{parentTitle}:{})} onClose={onClose} busy={busy} className="resource-permission-dialog" footer={<>
    <span className="moki-ui-muted">{uiText("已选")}{validSelected.length}{uiText("项")}</span><Button variant="ghost" disabled={!selected.size||busy} onClick={()=>setSelected(new Set())}>{uiText("清空")}</Button><Button disabled={busy} onClick={onClose}>{uiText("取消")}</Button><Button variant="primary" loading={busy} disabled={loading||Boolean(error)||(!allowEmpty&&!validSelected.length)} onClick={()=>void confirm()}>{confirmLabel}</Button>
  </>}>
    <p className="moki-ui-muted">{description??uiText("展开目录选择文件或文件夹；选择文件夹后，可读取其下资料。")}</p>
    <div className="resource-permission-toolbar"><label><Search className="moki-ui-search-icon" size={14} aria-hidden="true"/><Input className="moki-ui-toolbar-search" autoFocus aria-label={uiText("搜索资料库文件")} value={query} onChange={event=>{setQuery(event.target.value);setLimit(160);}} placeholder={uiText("搜索名称、路径或标签")}/></label><Button aria-pressed={onlySelected} onClick={()=>{setOnlySelected(!onlySelected);setLimit(160);}}>{onlySelected?uiText("查看全部"):uiText`已选 ${validSelected.length}`}</Button></div>
    {loading?<p role="status">{uiText("正在加载资料库…")}</p>:error&&!items.length?null:<div className="resource-permission-tree library-picker-tree" role="tree" aria-label={uiText("资料库树状目录")} aria-multiselectable="true">
      {rows.slice(0,limit).map(({item,depth,open})=>{const folder=item.kind==='folder'||item.kind==='local_folder';
        return <div role="treeitem" aria-level={depth+1} aria-selected={selected.has(item.id)} aria-expanded={folder?open:undefined} data-selected={selected.has(item.id)} className="resource-permission-item library-picker-row" key={item.id} style={{paddingLeft:Math.min(depth,8)*18+6}}>
          {folder?<IconButton className="library-picker-toggle" size="toolbar" variant="ghost" aria-label={`${open?uiText("收起"):uiText("展开")} ${item.name}`} onClick={()=>setExpanded(current=>{const next=new Set(current);next.has(item.id)?next.delete(item.id):next.add(item.id);return next;})}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</IconButton>:<span className="library-picker-toggle-spacer"/>}
          <label className="library-picker-select" title={item.target || item.name}>
            <ResourceLibraryPickerItemContent item={item}/>
            <span className="library-picker-selection"><input type="checkbox" aria-label={item.name} checked={selected.has(item.id)} disabled={!selected.has(item.id)&&selected.size>=maxSelected} onChange={()=>toggle(item.id)}/><ResourceLibraryPickerSelectionMark selected={selected.has(item.id)}/></span>
          </label>
        </div>;
      })}
      {!rows.length?<p className="resource-permission-empty">{query?uiText("没有匹配的资料"):onlySelected?uiText("尚未选择资料"):uiText("资料库暂无内容")}</p>:null}
      {rows.length>limit?<Button className="resource-permission-more" onClick={()=>setLimit(limit+160)}>{uiText("显示更多 · 还有")}{rows.length-limit}{uiText("项")}</Button>:null}
    </div>}
    {selected.size>=maxSelected?<p className="moki-ui-muted">{uiText("最多选择")}{maxSelected}{uiText("项；可选取上级文件夹来包含更多资料。")}</p>:null}
    {error||failure?<RequestErrorNotice error={error||failure} busy={Boolean(loading)} fallbackTitle={error?uiText("暂时无法读取资料库"):uiText("资料选择未完成")} onRetry={error?onRetry:undefined}/>:null}
  </SettingsDialog>;
}
