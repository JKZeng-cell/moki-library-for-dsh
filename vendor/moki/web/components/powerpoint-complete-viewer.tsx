import { l as uiText } from '../../../../src/i18n.js';
import {useEffect,useState} from 'react';
import {parsePresentation,ReactPptxViewer,PptxViewerError,type ReactPptxViewerProps,type ParsedPresentation} from '@extend-ai/react-pptx';
import {restorePowerPointPreviewAssets} from '../../shared/powerpoint-preview-assets.js';

export function PowerPointCompleteViewer(props:ReactPptxViewerProps){
  const [state,setState]=useState<{source:unknown;parsed?:ParsedPresentation;error?:PptxViewerError}>();
  const source=props.source;
  useEffect(()=>{
    const controller=new AbortController();
    void (async()=>{
      try{
        let bytes:Uint8Array|undefined;
        if(typeof source==='string'||source instanceof URL){
          const response=await fetch(source,{...props.parseOptions?.fetchInit,signal:controller.signal});
          if(!response.ok)throw new PptxViewerError('fetch-failed',`PowerPoint 文件读取失败 (${response.status})`);
          bytes=new Uint8Array(await response.arrayBuffer());
        }else if(source instanceof Uint8Array)bytes=source;
        else if(source instanceof ArrayBuffer)bytes=new Uint8Array(source);
        else if(source instanceof Blob)bytes=new Uint8Array(await source.arrayBuffer());
        let parsed=await parsePresentation(bytes ?? source,{...props.parseOptions,maxInputBytes:Infinity,signal:controller.signal});
        if(bytes)parsed=await restorePowerPointPreviewAssets(parsed,bytes,controller.signal);
        if(!controller.signal.aborted)setState({source,parsed});
      }catch(cause){
        if(!controller.signal.aborted)setState({source,error:cause instanceof PptxViewerError?cause:new PptxViewerError('parse-failed','PowerPoint 完整预览解析失败',{cause})});
      }
    })();
    return ()=>controller.abort();
  },[source]);
  const error=state?.source===source?state.error:undefined;
  useEffect(()=>{if(error)props.onError?.(error);},[error,props.onError]);
  if(error)return props.renderError?.(error) ?? <p role="alert">{error.message}</p>;
  if(state?.source!==source||!state.parsed)return props.renderLoading?.() ?? <p role="status">{uiText("正在解析 PowerPoint 文件")}</p>;
  return <ReactPptxViewer {...props} source={state.parsed}/>;
}
