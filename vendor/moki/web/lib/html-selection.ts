import { parse } from 'parse5';

export type HtmlSegment = { start:number; end:number; from:number; to:number };
export type HtmlSelection = { segments:HtmlSegment[]; expectedText:string };
const excluded = new Set(['head','script','style','template','noscript','textarea','input','select','button','iframe','object']);
export function htmlTextNodes(source:string) {
  const result:{path:number[];start:number;end:number;text:string;line:number}[]=[];
  const walk=(node:any,path:number[],blocked=false)=>{
    blocked ||= excluded.has(node.tagName);
    const loc=node.sourceCodeLocation;
    if(!blocked && node.nodeName==='#text' && loc) result.push({path,start:loc.startOffset,end:loc.endOffset,text:node.value,line:loc.startLine});
    if(!blocked)node.childNodes?.forEach((child:any,index:number)=>walk(child,[...path,index],blocked));
  };
  walk(parse(source,{sourceCodeLocationInfo:true,scriptingEnabled:false}),[]);
  return result;
}
export function mappedHtmlNodes(source:string,doc:Document) {
  return htmlTextNodes(source).flatMap(entry=>{
    const node=entry.path.reduce<Node|undefined>((parent,index)=>parent?.childNodes[index],doc);
    return node?.nodeType===3 && node.textContent===entry.text ? [{...entry,node:node as Text}] : [];
  });
}
export function mappedHtmlElements(source:string,doc:Document) {
  const result=new Map<Element,{start:number;end:number;line:number}>();
  const walk=(node:any,path:number[])=>{
    if(['head','script','style','template','noscript','iframe','object'].includes(node.tagName))return;
    const loc=node.sourceCodeLocation;
    if(loc && node.tagName && !['html','body'].includes(node.tagName)){
      const element=path.reduce<Node|undefined>((parent,index)=>parent?.childNodes[index],doc) as Element|undefined;
      if(element?.nodeType===1 && element.tagName.toLowerCase()===node.tagName.toLowerCase())result.set(element,{start:loc.startOffset,end:loc.endOffset,line:loc.startLine});
    }
    node.childNodes?.forEach((child:any,index:number)=>walk(child,[...path,index]));
  };
  walk(parse(source,{sourceCodeLocationInfo:true,scriptingEnabled:false}),[]);return result;
}
// Inline formatting follows its containing block; blank padding selects the
// container itself. Never fall back to the whole page or an injected overlay.
export function htmlModuleAt(target:Element|null,elements:ReturnType<typeof mappedHtmlElements>,win:Window) {
  for(let node=target;node && !['BODY','HTML'].includes(node.tagName);node=node.parentElement){
    if(!elements.has(node))continue;
    const style=win.getComputedStyle(node),rect=node.getBoundingClientRect();
    if(style.display==='none'||style.visibility==='hidden'||rect.width<2||rect.height<2)continue;
    if(/^(IMG|SVG|CANVAS|VIDEO|AUDIO|BUTTON|INPUT|SELECT|TEXTAREA|A|LI|TD|TH|TR|TABLE|FIGURE|SECTION|ARTICLE|HEADER|FOOTER|NAV|ASIDE|MAIN|FORM|H[1-6]|P)$/.test(node.tagName) || !['inline','contents'].includes(style.display))return node;
  }
  return null;
}
export function htmlElementLabel(element:Element) {
  const parts:string[]=[];
  for(let node:Element|null=element;node&&!['BODY','HTML'].includes(node.tagName)&&parts.length<5;node=node.parentElement){
    if(node.id){parts.unshift('#'+CSS.escape(node.id));break;}
    const siblings=[...node.parentElement?.children||[]].filter(child=>child.tagName===node!.tagName);
    parts.unshift(node.tagName.toLowerCase()+(siblings.length>1?`:nth-of-type(${siblings.indexOf(node)+1})`:''));
  }
  return parts.join(' > ');
}
const escapeText=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function replaceHtmlSelection(source:string,selection:HtmlSelection,replacement:string) {
  const stale=()=>{throw Error('HTML selection changed. Select the text again.');};
  if(!selection.segments?.length || selection.segments.length>256 || selection.expectedText.length>8000)stale();
  const nodes=htmlTextNodes(source),seen=new Set<number>();
  const changes=selection.segments.map((s,index)=>{
    const node=nodes.find(n=>n.start===s.start && n.end===s.end);
    if(!node || seen.has(s.start) || ![s.start,s.end,s.from,s.to].every(Number.isSafeInteger) || s.from<0 || s.to<=s.from || s.to>node.text.length) return stale();
    seen.add(s.start);
    return {start:s.start,end:s.end,expected:node.text.slice(s.from,s.to),text:escapeText(node.text.slice(0,s.from)+(index===0?replacement:'')+node.text.slice(s.to))};
  });
  if(changes.map(c=>c.expected).join('')!==selection.expectedText)stale();
  const ordered=changes.sort((a,b)=>b.start-a.start);
  for(let i=1;i<ordered.length;i++)if(ordered[i].end>ordered[i-1].start)stale();
  let next=source;
  for(const c of ordered)next=next.slice(0,c.start)+c.text+next.slice(c.end);
  return next;
}
