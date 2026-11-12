import {useRef,type ChangeEvent} from 'react';
import {Check,Undo2,ChevronDown,Sparkles,LoaderCircle,LocateFixed} from 'lucide-react';
import {l as uiText} from '../../../../src/i18n.js';
import {textChanges} from '../../../../src/edit-review.js';
import './edit-review.css';

export type TextReview = {id:string;sequence:number;createdAt:string;before:string};
export type ReviewChange = {kind:string;unitId?:string;sheetId?:string;sheetName?:string;range?:string;row?:number;column?:number;slideId?:string;page?:number;elementId?:string;start?:number;end?:number;startOffset?:number;endOffset?:number;before?:string;after?:string;structural?:boolean;removed?:boolean;transform?:unknown};
export type ReviewEntry = {id:string;sequence:number;createdAt:string;count?:number;changes:ReviewChange[];truncated?:boolean};
export function reviewLocation(change:ReviewChange) {
  if(change.kind==='sheet')return [change.sheetName,change.range].filter(Boolean).join(' · ')||uiText('工作表');
  if(change.kind==='slide')return uiText`幻灯片 ${change.page||'—'}`;
  return uiText('文字与格式');
}
export function EditReviewBar({entries,busy,status,onResolve,onLocate}:{entries:ReviewEntry[];busy:boolean;status?:string;onResolve:(action:'accept'|'reject',id:string)=>void;onLocate:(change:ReviewChange)=>void}) {
  const latest=entries.at(-1);
  if(!latest&&!busy)return null;
  return <section className="moki-edit-review" aria-label={uiText('AI 修改审阅')} aria-busy={busy}>
    <div className="moki-review-line">
      <span className="moki-review-label" role="status">{busy?<LoaderCircle size={15} className="animate-spin"/>:<Sparkles size={15}/>}<strong>{busy?(status||uiText('AI 修改中…')):uiText`${entries.length} 次修改待确认`}</strong></span>
      <span className="moki-review-buttons" onMouseDown={event=>event.preventDefault()}>
        <button type="button" disabled={busy||!latest} onClick={()=>latest&&onResolve('reject',latest.id)}><Undo2 size={14}/>{entries.length>1?uiText('取消最新一次'):uiText('取消本次修改')}</button>
        <button type="button" data-primary disabled={busy||!latest} onClick={()=>latest&&onResolve('accept',latest.id)}><Check size={14}/>{entries.length>1?uiText('采纳全部'):uiText('采纳')}</button>
      </span>
    </div>
    {latest&&<details className="moki-review-details">
      <summary><ChevronDown size={13}/>{uiText('查看改动')}<span>{uiText('采纳后保存到原文件，保持当前页面；可继续编辑。')}</span></summary>
      <div className="moki-review-history">{entries.slice().reverse().map(entry=><section key={entry.id}>
        <header>{uiText`第 ${entry.sequence} 次修改`} · {uiText`${entry.count??entry.changes.length} 处改动`}</header>
        {entry.changes.slice(0,30).map((change,index)=><div className="moki-review-change" key={index}>
          <button type="button" onClick={()=>onLocate(change)} title={uiText('定位改动')}><LocateFixed size={13}/>{reviewLocation(change)}</button>
          {change.before&&<del>{change.before}</del>}{change.after&&<ins>{change.after}</ins>}
          {!change.before&&!change.after&&<span>{uiText('内容或格式已调整')}</span>}
        </div>)}
        {(entry.truncated||entry.changes.length>30)&&<p>{uiText('更多改动已保留，可在文件中查看。')}</p>}
      </section>)}</div>
    </details>}
  </section>;
}
export function ReviewTextEditor({value,onChange,baseline,locked}:{value:string;onChange:(event:ChangeEvent<HTMLTextAreaElement>)=>void;baseline?:string;locked:boolean}) {
  const mirror=useRef<HTMLPreElement>(null),changes=baseline===undefined?[]:textChanges(baseline,value);
  const normalize=(text:string)=>text.replace(/\r\n?/g,'\n');
  let offset=0;
  const highlighted=changes.map((change,index)=>{const before=normalize(value.slice(offset,change.start)),changed=normalize(value.slice(change.start,change.end));offset=change.end;return <span key={index}>{before}<mark data-moki-review-highlight data-deleted={change.removed||undefined}>{changed||'\u200b'}</mark></span>});
  return <div className="moki-review-text-editor">
    <pre ref={mirror} aria-hidden="true">{highlighted}{normalize(value.slice(offset))}{'\n'}</pre>
    <textarea aria-label={uiText('资料文本编辑器')} autoFocus readOnly={locked} value={value} onChange={onChange} spellCheck={false}
      onScroll={event=>{if(mirror.current){mirror.current.scrollTop=event.currentTarget.scrollTop;mirror.current.scrollLeft=event.currentTarget.scrollLeft;}}}/>
  </div>;
}
