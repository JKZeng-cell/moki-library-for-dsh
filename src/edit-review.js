// Review decorations are presentation data, never document formatting.
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b)
export function textChange(before = '', after = '') {
  let start=0, left=before.length, right=after.length
  while(start<left && start<right && before[start]===after[start])start++
  while(left>start && right>start && before[left-1]===after[right-1]){left--;right--}
  if(start===left && start===right)return null
  return {kind:'text',start,end:right,before:before.slice(start,left).slice(0,600),after:after.slice(start,right).slice(0,600),removed:right===start}
}
// Keep independent line edits separate, without a quadratic whole-document diff.
// Changes that insert/remove lines retain a single surrounding review range.
export function textChanges(before = '', after = '') {
  const oldLines=before.split(/(?<=\n)|(?<=\r)(?!\n)/),newLines=after.split(/(?<=\n)|(?<=\r)(?!\n)/)
  if(oldLines.length!==newLines.length||oldLines.length>20000){const change=textChange(before,after);return change?[change]:[]}
  const changes=[];let offset=0
  for(let index=0;index<newLines.length;index++) {
    const change=textChange(oldLines[index],newLines[index])
    if(change)changes.push({...change,start:offset+change.start,end:offset+change.end})
    offset+=newLines[index].length
  }
  return changes
}
const snippet = value => String(value?.f ?? value?.v ?? value?.p?.body?.dataStream ?? '').slice(0,600)
const columnName = n => {let name='';for(n++;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name}
export function officeChanges(before,after,unitId,kind) {
  const changes=[]
  const add=change=>changes.push({unitId,...change})
  if(kind==='sheet') {
    for(const sheetId of new Set([...Object.keys(before?.sheets||{}),...Object.keys(after?.sheets||{})])) {
      const a=before?.sheets?.[sheetId],b=after?.sheets?.[sheetId]
      if(!a||!b){add({kind:'sheet',sheetId,sheetName:(b||a).name,structural:true});continue}
      const rows=new Set([...Object.keys(a.cellData||{}),...Object.keys(b.cellData||{})])
      for(const row of rows)for(const col of new Set([...Object.keys(a.cellData?.[row]||{}),...Object.keys(b.cellData?.[row]||{})])) {
        const old=a.cellData?.[row]?.[col],next=b.cellData?.[row]?.[col]
        if(equal(old,next))continue
        add({kind:'sheet',sheetId,sheetName:b.name,row:+row,column:+col,range:columnName(+col)+(+row+1),before:snippet(old),after:snippet(next),removed:!next})
      }
      // Row/column sizes, styles, drawings and other layout edits still get a location.
      const {cellData:ac,...am}=a,{cellData:bc,...bm}=b
      if(!equal(am,bm))add({kind:'sheet',sheetId,sheetName:b.name,structural:true})
    }
  } else if(kind==='slide') {
    const pages=value=>value?.slides||{}
    for(const slideId of new Set([...Object.keys(pages(before)),...Object.keys(pages(after))])) {
      const a=pages(before)[slideId],b=pages(after)[slideId]
      const page=(after?.slideOrder||before?.slideOrder||[]).indexOf(slideId)+1
      if(!a||!b){add({kind:'slide',slideId,page,structural:true,removed:!b});continue}
      for(const elementId of new Set([...Object.keys(a.elements||{}),...Object.keys(b.elements||{})])) {
        const old=a.elements?.[elementId],next=b.elements?.[elementId]
        if(equal(old,next))continue
        const content=e=>e?.shapeData?.shapeText?.dataModel?.doc?.body?.dataStream||e?.shapeData?.shapeText?.text||''
        add({kind:'slide',slideId,page,elementId,transform:(next||old).transform,before:content(old).slice(0,600),after:content(next).slice(0,600),removed:!next})
      }
      const {elements:ae,...am}=a,{elements:be,...bm}=b
      if(!equal(am,bm))add({kind:'slide',slideId,page,structural:true})
    }
  } else if(kind==='doc') {
    const spans=textChanges(before?.body?.dataStream,after?.body?.dataStream)
    if(spans.length)for(const change of spans)add({...change,kind:'document',startOffset:change.start,endOffset:change.end})
    else if(!equal(before,after))add({kind:'document',startOffset:0,endOffset:after?.body?.dataStream?.length||0,structural:true})
  }
  if(!changes.length&&!equal(before,after))add({kind:kind==='doc'?'document':kind,structural:true})
  return {count:changes.length,changes:changes.slice(0,500),truncated:changes.length>500}
}
