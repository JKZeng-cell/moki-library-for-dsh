import {useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowUp,Paperclip,Plus,Quote,X,LoaderCircle} from 'lucide-react';

export type QuickSubmission={id:string;prompt:string;files:File[]};
type Props={anchor:{x:number;y:number};label:string;excerpt?:string;t:(text:string)=>string;onSend:(submission:QuickSubmission)=>Promise<void>;onClose:()=>void};
/** Shared interaction contract for the library and canvas selection actions. */
export function SelectionComposer({anchor,label,excerpt,t,onSend,onClose}:Props){
  const box=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null),picker=useRef<HTMLInputElement>(null),busy=useRef(false);
  const request=useRef<string>(crypto.randomUUID());
  const [prompt,setPrompt]=useState(''),[files,setFiles]=useState<File[]>([]),[error,setError]=useState(''),[sending,setSending]=useState(false);
  const [position,setPosition]=useState({left:anchor.x,top:anchor.y});
  useLayoutEffect(()=>{
    const place=()=>{const rect=box.current?.getBoundingClientRect();if(rect)setPosition({left:Math.max(8,Math.min(anchor.x,innerWidth-rect.width-8)),top:Math.max(8,Math.min(anchor.y,innerHeight-rect.height-8))});};
    const observer=new ResizeObserver(place);if(box.current)observer.observe(box.current);place();input.current?.focus({preventScroll:true});
    window.addEventListener('resize',place);return()=>{observer.disconnect();window.removeEventListener('resize',place);};
  },[anchor.x,anchor.y]);
  function change(){request.current=crypto.randomUUID();setError('');}
  function add(values:File[]){
    if(busy.current)return;
    const accepted=values.filter(file=>file.size<=32*1024*1024);
    change();setFiles(current=>[...current,...accepted.filter(file=>!current.some(old=>old.name===file.name&&old.size===file.size&&old.lastModified===file.lastModified))]);
    if(accepted.length!==values.length)setError(t('单个对话附件不能超过 32 MB'));
  }
  async function submit(){
    if(busy.current||(!prompt.trim()&&!files.length))return;
    busy.current=true;setSending(true);setError('');
    try{await onSend({id:request.current,prompt:prompt.trim(),files});onClose();}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{busy.current=false;setSending(false);}
  }
  return createPortal(<div ref={box} className="moki-selection-composer" data-selection-composer data-whiteboard-control-surface role="dialog" aria-label={t('选区快捷对话')} style={position}
    onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}
    onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.preventDefault();if(!busy.current)onClose();}}}
    onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';}}}
    onDrop={event=>{if(event.dataTransfer.files.length){event.preventDefault();event.stopPropagation();add([...event.dataTransfer.files]);}}}>
    <header><div className="moki-quick-reference" aria-label={t('已附带选区')} title={[label,excerpt].filter(Boolean).join('\n')}><Quote size={13} aria-hidden="true"/><div><strong>{label}</strong>{excerpt&&<small>{excerpt}</small>}</div></div><button type="button" className="moki-quick-icon" disabled={sending} aria-label={t('关闭快捷输入')} title={t('关闭快捷输入')} onClick={onClose}><X size={15}/></button></header>
    <textarea ref={input} value={prompt} rows={2} disabled={sending} aria-label={t('选区指令')} placeholder={t('输入指令，与选区一起发送…')}
      onChange={event=>{change();setPrompt(event.target.value);}}
      onPaste={event=>{if(event.clipboardData.files.length){event.preventDefault();add([...event.clipboardData.files]);}}}
      onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&event.keyCode!==229){event.preventDefault();void submit();}}}/>
    {!!files.length&&<ul className="moki-quick-files" aria-label={t('附件')}>{files.map((file,index)=><li key={index}><Paperclip size={12}/><span title={file.name}>{file.name}</span><button type="button" className="moki-quick-icon" disabled={sending} aria-label={t('移除附件')+' '+file.name} onClick={()=>{change();setFiles(files.filter((_,i)=>i!==index));}}><X size={12}/></button></li>)}</ul>}
    {error&&<p className="moki-quick-error" role="alert">{error}</p>}
    <footer><input ref={picker} type="file" multiple hidden onChange={event=>{add([...(event.target.files??[])]);event.target.value='';}}/><button type="button" className="moki-quick-attach" disabled={sending} onClick={()=>picker.current?.click()} aria-label={t('添加附件')} title={t('添加附件')}><Plus size={18}/></button><span className="moki-quick-agent" title={t('与 DSH 对话')}><span className="dsh-whale" aria-hidden="true"/>DSH</span><span className="moki-quick-hint">{t('Shift+Enter 换行')}</span><button type="button" className="moki-quick-send" disabled={sending||(!prompt.trim()&&!files.length)} aria-label={t(sending?'正在发送…':'发送')} title={t(sending?'正在发送…':'发送')} onClick={()=>void submit()}>{sending?<LoaderCircle size={17} className="moki-quick-spinner"/>:<ArrowUp size={20}/>}</button></footer>
  </div>,document.body);
}
