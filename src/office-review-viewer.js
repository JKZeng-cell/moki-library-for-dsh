// Runs inside the pinned Office viewer. Decorations belong to the render layer;
// none of the highlights are written into a cell, paragraph or slide snapshot.
export function installOfficeReview() {
  let changes=[],locate,signature='',decorations=[],pending=true
  const find=(unit,matches)=>{
    const queue=[unit?._injector,window.univerAPI?._injector],seen=new Set()
    while(queue.length){const injector=queue.shift();if(!injector||seen.has(injector))continue;seen.add(injector)
      for(const values of injector.resolvedDependencyCollection?.resolvedDependencies?.values?.()||[])for(const value of Array.isArray(values)?values:[values])if(matches(value))return value
      queue.push(injector.parent,...injector.children||[])
    }
  }
  const clear=()=>{for(const item of decorations)try{item.dispose()}catch{}decorations=[];document.documentElement.removeAttribute('data-moki-review-highlights')}
  const style=()=>({stroke:'#51ad7b',strokeWidth:2,fill:document.documentElement.dataset.dshTheme==='dark'?'rgba(93,213,149,0.22)':'rgba(49,168,104,0.18)'})
  function paint() {
    const api=window.univerAPI;if(!api)return
    const book=api.getActiveWorkbook?.(),pres=api.getActivePresentation?.(),doc=pres?null:api.getActiveDocument?.(),unit=book||pres||doc
    if(!unit)return
    const unitId=unit.getId(),sheet=book?.getActiveSheet(),slide=pres?.getActiveSlide(),page=slide?.getId()
    const next=JSON.stringify([unitId,sheet?.getSheetId(),page,changes,document.documentElement.dataset.dshTheme])
    if(!pending&&signature===next)return
    const own=changes.filter(c=>c.unitId===unitId && (!book||c.sheetId===sheet?.getSheetId()) && (!pres||c.slideId===page))
    const render=find(unit,v=>typeof v?.getRenderUnitById==='function')?.getRenderUnitById(unitId),scene=render?.scene
    if(!scene)return
    clear()
    try {
      if(book){
        for(const change of own){const range=change.range?sheet.getRange(change.range):sheet.getDataRange();decorations.push(range.highlight(style()))}
      } else if(pres) {
        const paper=scene.getObject('slide-page-rect');if(!paper)return
        for(const [index,change] of own.entries()) {
          const object=change.elementId?scene.getObject('slide-drawing-'+unitId+'-'+page+'-'+change.elementId):paper
          const box=object||change.transform;if(!box)continue
          const rect=new paper.constructor('moki-ai-review-'+index,{left:object?box.left:paper.left+(box.left??box.x??0),top:object?box.top:paper.top+(box.top??box.y??0),width:Math.max(3,box.width||3),height:Math.max(3,box.height||3),angle:box.angle||0,...style(),evented:false})
          scene.addObject(rect,1000);decorations.push(rect)
        }
      } else if(doc&&own.length) {
        const manager=find(doc,v=>typeof v?.addDocRanges==='function'&&typeof v?.getAllTextRanges==='function')
        if(!manager)return
        const saved=manager._rangeList.slice(),active=saved.find(range=>range.isActive?.()),previous=manager.getAllTextRanges(),length=doc.getBody().dataStream.length
        manager.addDocRanges(own.map(c=>({startOffset:Math.min(c.startOffset??0,Math.max(0,length-2)),endOffset:Math.min(Math.max((c.startOffset??0)+1,c.endOffset??length-2),Math.max(1,length-2)),rangeType:'TEXT',style:{...style(),strokeActive:'#51ad7b'}})),false,{shouldFocus:false})
        const added=manager._rangeList.filter(range=>!saved.includes(range));manager._rangeList=saved
        for(const range of added){range.deactivate();decorations.push(range)}
        active?.activate()
        manager._textSelectionInner$.next({textRanges:previous,rectRanges:manager.getAllRectRanges(),segmentId:manager._currentSegmentId,segmentPage:manager._currentSegmentPage,style:manager._selectionStyle,isEditing:false,options:{shouldFocus:false}})
      }
      scene.makeDirty()
      signature=next;pending=false
      document.documentElement.dataset.mokiReviewHighlights=String(decorations.length)
    }catch(error){window.__mokiReviewError=String(error);clear()}
  }
  function focusChange(change) {
    const api=window.univerAPI;if(!api)return false
    try {
      if(change.kind==='sheet'){
        const book=api.getActiveWorkbook?.(),sheet=book?.getSheetBySheetId(change.sheetId);if(!sheet)return false
        book.setActiveSheet?.(sheet);if(change.range){const range=sheet.getRange(change.range);book.setActiveRange(range);sheet.scrollToCell?.(change.row||0,change.column||0)}
      }else if(change.kind==='slide'){
        const p=api.getActivePresentation?.(),slide=p?.getSlideById(change.slideId);if(!slide)return false;p.setActiveSlide(slide)
      }else if(change.kind==='document'){const doc=api.getActiveDocument?.();if(!doc)return false;doc.setSelection(change.startOffset||0,Math.max((change.startOffset||0)+1,change.endOffset||0))}
      return true
    }catch{return false}
  }
  window.addEventListener('message',event=>{
    if(event.source!==window.parent||event.data?.type!=='moki:univer-review')return
    const first=!changes.length,incoming=Array.isArray(event.data.changes)?event.data.changes.slice(-1000):[]
    pending ||= JSON.stringify(incoming)!==JSON.stringify(changes);changes=incoming
    locate=event.data.locate||(first&&changes[0]?.kind!=='document'?changes[0]:null)
  })
  const timer=setInterval(()=>{if(locate&&focusChange(locate))locate=null;paint()},200)
  window.addEventListener('pagehide',()=>{clearInterval(timer);clear()},{once:true})
}
