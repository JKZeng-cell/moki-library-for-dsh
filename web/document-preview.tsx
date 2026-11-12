import { l as uiText } from '../src/i18n.js';
import {useCallback,useEffect,useRef,useState} from "react";
import {PanelRightOpen} from "lucide-react";
import {PreviewChat} from "./preview-chat";
import type {ResourceLibraryItem} from "../vendor/moki/shared/resource-library-contract";
import {ResourceLibraryPreviewer} from "../vendor/moki/web/components/resource-library-previewer";
import {Button} from "../vendor/moki/web/components/ui-controls";
import {apiFetch} from "../vendor/moki/web/lib/api-fetch";
import {openResourceLibraryItem} from "../vendor/moki/web/lib/resource-library-api";

type DocumentData = {item:ResourceLibraryItem; appearance?:Record<string,unknown>;chatId?:string;chatOrigin?:string};
type Props = {standalone:boolean; resumeOffice:boolean; initialize:(data:DocumentData)=>void;
  close:()=>void; dock:(office:boolean,destination:'sidebar'|'main')=>Promise<void>;chatAction:(action:'compose'|'hide-chat'|'activate-chat')=>Promise<void>};

export function DocumentPreview({standalone,resumeOffice,initialize,close,dock,chatAction}:Props) {
  const [data,setData]=useState<DocumentData>();
  const [error,setError]=useState("");
  const [moving,setMoving]=useState(false);
  const checkpoint=useRef<()=>Promise<void>>(undefined);
  const requestClose=useRef<()=>void>(undefined);
  const dirty=useRef(false);
  const transferring=useRef(false);
  const saveCheckpoint=useCallback((fn:(()=>Promise<void>)|undefined)=>{checkpoint.current=fn},[]);
  const saveClose=useCallback((fn:(()=>void)|undefined)=>{requestClose.current=fn},[]);
  useEffect(()=>{
    let live=true;
    void (async()=>{
      const res=await apiFetch("/api/dsh/document");
      const documentData=await res.json();
      if (!res.ok) throw new Error(documentData.error || uiText("未能打开预览"));
      if(live){initialize(documentData);setData(documentData)}
    })().catch(e=>{if(live)setError(e.message)});
    const beforeUnload=(e:BeforeUnloadEvent)=>{if(dirty.current){e.preventDefault();e.returnValue=""}};
    const nativeClose=()=>requestClose.current?.();
    const report=(e:Event)=>setError(String((e as CustomEvent).detail));
    if(standalone) window.addEventListener("beforeunload",beforeUnload);
    window.addEventListener("moki:request-document-close",nativeClose);
    window.addEventListener("moki:document-error",report);
    return ()=>{live=false;window.removeEventListener("beforeunload",beforeUnload);window.removeEventListener("moki:request-document-close",nativeClose);window.removeEventListener("moki:document-error",report)};
  },[initialize,standalone]);
  useEffect(()=>{
    if(data)window.dispatchEvent(new CustomEvent("moki:document-ready",{detail:{name:data.item.name}}));
  },[data]);
  const officeEditing=()=>Boolean(document.querySelector('iframe[data-office-editor]'));
  async function dockDocument(destination:'sidebar'|'main'='sidebar'){
    if(transferring.current)return;
    transferring.current=true;
    setMoving(true);setError("");
    try {
      await checkpoint.current?.();
      await dock(officeEditing(),destination);
      dirty.current=false;
      close();
    } catch(e){setError(e instanceof Error?e.message:uiText("侧边工作区打开失败"));transferring.current=false;setMoving(false)}
  }
  useEffect(()=>{
    const prepare=async(e:Event)=>{
      const port=(e as CustomEvent<MessagePort>).detail;
      if(transferring.current){port.postMessage({error:uiText("文件正在转交")});return}
      transferring.current=true;setMoving(true);
      try{await checkpoint.current?.();port.postMessage({office:officeEditing()})}
      catch(e){port.postMessage({error:String(e)});resume()}
    };
    const resume=()=>{transferring.current=false;setMoving(false)};
    const toSide=(event:Event)=>{void dockDocument((event as CustomEvent).detail==='main'?'main':'sidebar')};
    window.addEventListener("moki:checkpoint-document",prepare);
    window.addEventListener("moki:resume-document",resume);
    window.addEventListener("moki:dock-document",toSide);
    return ()=>{window.removeEventListener("moki:checkpoint-document",prepare);window.removeEventListener("moki:resume-document",resume);window.removeEventListener("moki:dock-document",toSide)};
  },[dock,close]);
  return <>
    {error && <div className="moki-document-feedback" role="alert">{error}<button type="button" onClick={()=>setError("")} aria-label={uiText("关闭提示")}>×</button></div>}
    {!data && !error && <div className="moki-document-loading" role="status">{uiText("正在打开预览…")}</div>}
    {data && <div className="dsh-file-view" data-moki-document={data.item.id} inert={moving || undefined}>
      <ResourceLibraryPreviewer item={data.item} displayMode="embedded" resumeOffice={resumeOffice}
        onOpen={item=>openResourceLibraryItem(item.id)} onClose={()=>{dirty.current=false;close()}}
        onDirtyChange={value=>{dirty.current=value}} onCheckpointReady={saveCheckpoint} onCloseRequestReady={saveClose}
        headerActions={standalone && <Button size="compact" className="dsh-compact-action" aria-label={uiText("添加到侧边工作区")}
          title={uiText("在 DSH 侧边工作区继续预览或编辑")} onClick={()=>void dockDocument()}><PanelRightOpen size={15}/><span className="dsh-action-label">{uiText("添加到侧边工作区")}</span></Button>}/>
    </div>}
    {standalone && data && <PreviewChat origin={data.chatOrigin} action={chatAction}/>}
    {moving && <div className="moki-document-feedback" role="status">{uiText("正在转交文件预览…")}</div>}
  </>;
}
