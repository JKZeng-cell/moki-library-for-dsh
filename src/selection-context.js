// Shared by the composer and host. Full editor snapshots remain local; only
// the selected content and one canonical location enter the conversation.
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined&&value[key]!==null).map(key=>[key,value[key]]))
export function selectionData(selection){
  try{return JSON.parse(selection?.content||'{}')}catch{return {}}
}
export function compactSelection(data,{maxChars=4000,detail='compact'}={}){
  if(detail==='full')return data
  const editor=data.editorSelection,location=editor||data.location||{}
  const result={...pick(data,['file','mode']),location:pick(location,[
    'kind','scope','indexUnit','unitId','sheetId','sheetName','range','row','column','endRow','endColumn',
    'slideId','page','endPage','slideName','selectedElementIds','textSelection','startOffset','endOffset','segmentId','collapsed',
    'start','end','line','endLine','endColumn','path','element','byteOffset','time','duration','coordinateSpace','surface','region','point'
  ])}
  if(Array.isArray(location.ranges)&&!(location.ranges.length===1&&location.ranges[0]===location.range))result.location.ranges=location.ranges
  let remaining=maxChars,truncated=Boolean(data.selectedTextTruncated||location.truncated||location.cellsTruncated)
  const bounded=value=>{const text=String(value??''),slice=text.slice(0,Math.max(0,remaining));remaining-=slice.length;if(slice.length<text.length)truncated=true;return slice}
  if(Array.isArray(location.values)){
    result.values=location.values.slice(0,50).map(row=>row.slice(0,20).map(bounded))
    const formulas=[]
    for(let r=0;r<(location.formulas?.length||0)&&r<50;r++)for(let c=0;c<(location.formulas[r]?.length||0)&&c<20;c++)if(location.formulas[r][c])formulas.push({row:r,column:c,formula:bounded(location.formulas[r][c])})
    if(formulas.length)result.formulas=formulas
  }else if(Array.isArray(location.cells)){
    result.cells=location.cells.slice(0,200).map(cell=>({...pick(cell,['address']),value:bounded(cell.value),...(cell.formula?{formula:bounded(cell.formula)}:{})}))
  }else{
    const text=data.selectedText??location.selectedText
    if(text!==undefined&&text!==null){result.text=bounded(text);result.textLength=text.length}
    // Whole shape text is useful only when objects, rather than text, are selected.
    if(location.elements?.length&&!location.textSelection){
      result.elements=location.elements.map(element=>({...pick(element,['id','name','type','transform'])}))
    }
  }
  if(truncated)result.truncated=true
  if(data.visual)result.visual=pick(data.visual,['width','height'])
  if(data.revision!==undefined&&data.mode==='text-editor')result.revision=data.revision
  if(data.unsavedDraft&&typeof data.unsavedDraft==='object')result.draft=pick(data.unsavedDraft,['sessionId','unitId','kind'])
  return result
}
export function selectionQuote(selection){
  if(!selection)return ''
  const data=selectionData(selection)
  const content=Array.isArray(data.selectedItems)?{
    items:data.selectedItems.slice(0,20).map(item=>pick(item,['id','name','kind'])),total:data.selectedIds?.length??selection.itemCount
  }:compactSelection(data,{maxChars:1000})
  // IDs needed by advanced APIs are available on demand from context.
  delete content.draft;delete content.revision
  return 'MOKI资料库 · '+selection.label+'\n'+JSON.stringify(content)+'\n使用 moki_library_context 读取当前选区；返回 selectionRef 后可直接用 moki_library_edit_selection 修改草稿。'
}
