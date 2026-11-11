import {useEffect,useRef,useState} from 'react';
import {getDocument,GlobalWorkerOptions,TextLayer,type PDFDocumentProxy} from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=worker;
export default function PdfPreview({url}:{url:string}){
  const [pdf,setPdf]=useState<PDFDocumentProxy>(),[page,setPage]=useState(1),[zoom,setZoom]=useState(1),[error,setError]=useState(''),[busy,setBusy]=useState(true),[width,setWidth]=useState(700);
  const scroll=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),layer=useRef<HTMLDivElement>(null);
  useEffect(()=>{const host=scroll.current!,observer=new ResizeObserver(()=>setWidth(Math.max(160,host.clientWidth-32)));observer.observe(host);return()=>observer.disconnect()},[]);
  useEffect(()=>{let disposed=false;const task=getDocument({url,useSystemFonts:true,isEvalSupported:false,rangeChunkSize:262144});task.promise.then(doc=>{if(!disposed)setPdf(doc)}).catch(e=>{if(!disposed){setError(e.message);setBusy(false)}});return()=>{disposed=true;void task.destroy()}},[url]);
  useEffect(()=>{
    if(!pdf||!canvas.current||!layer.current)return;
    let disposed=false,render:any,textLayer:TextLayer;setBusy(true);setError('');
    window.dispatchEvent(new Event('moki:preview-location-changed'));
    void(async()=>{try{
      const sheet=await pdf.getPage(page);if(disposed)return;
      const viewport=sheet.getViewport({scale:Math.min(1.8,width/sheet.getViewport({scale:1}).width)*zoom}),density=Math.min(devicePixelRatio,2),target=canvas.current!,container=layer.current!;
      target.width=Math.ceil(viewport.width*density);target.height=Math.ceil(viewport.height*density);target.style.width=viewport.width+'px';target.style.height=viewport.height+'px';container.replaceChildren();
      container.style.setProperty('--total-scale-factor',String(viewport.scale));container.parentElement!.style.width=viewport.width+'px';container.parentElement!.style.height=viewport.height+'px';
      render=sheet.render({canvas:target,viewport,transform:[density,0,0,density,0,0]});await render.promise;if(disposed)return;
      textLayer=new TextLayer({textContentSource:await sheet.getTextContent(),container,viewport});await textLayer.render();if(!disposed)setBusy(false);
    }catch(e:any){if(!disposed){setError(e.message);setBusy(false)}}})();
    return()=>{disposed=true;render?.cancel();textLayer?.cancel()};
  },[pdf,page,zoom,width]);
  const location=JSON.stringify({kind:'pdf',page,totalPages:pdf?.numPages});
  return <div className="library-pdf-viewer" data-moki-view-context={location} data-moki-location={location}>
    <div className="library-extra-toolbar"><button disabled={!pdf||page<=1} onClick={()=>setPage(page-1)}>上一页</button><label>页码 <input aria-label="PDF 页码" type="number" min={1} max={pdf?.numPages||1} value={page} onChange={e=>{const n=Number(e.target.value);if(n>=1&&n<=(pdf?.numPages||1))setPage(n)}}/></label><span>/ {pdf?.numPages||'…'}</span><button disabled={!pdf||page>=pdf.numPages} onClick={()=>setPage(page+1)}>下一页</button><button aria-label="缩小 PDF" disabled={zoom<=.5} onClick={()=>setZoom(Math.max(.5,zoom-.25))}>−</button><button aria-label="适应 PDF 宽度" onClick={()=>setZoom(1)}>{Math.round(zoom*100)}%</button><button aria-label="放大 PDF" disabled={zoom>=3} onClick={()=>setZoom(Math.min(3,zoom+.25))}>＋</button></div>
    <div ref={scroll} className="library-extra-scroll library-pdf-pages">{busy&&<p role="status">正在读取第 {page} 页…</p>}{error&&<p role="alert">{error}；可使用系统打开。</p>}<div className="library-pdf-page"><canvas ref={canvas}/><div ref={layer} className="library-pdf-text-layer" data-moki-selection-text="pdf"/></div></div>
  </div>
}
