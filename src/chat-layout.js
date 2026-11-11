const directions = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]}
const clamp = (value,min,max) => Math.max(min, Math.min(max,value))

function limits(panel) {
  const inset = Math.min(8, Math.floor(Math.min(panel.clientWidth,panel.clientHeight)/8))
  const width = panel.clientWidth - 2*inset, height = panel.clientHeight - 2*inset
  return {inset,width,height,minWidth:Math.min(312,width),minHeight:Math.min(300,height)}
}

function fit(rect, area) {
  const {inset,width,height,minWidth,minHeight} = area
  const w = clamp(rect?.width ?? 540, minWidth, width)
  const h = clamp(rect?.height ?? 510, minHeight, height)
  return {
    width:w, height:h,
    left:clamp(rect?.left ?? width+inset-w,inset,width+inset-w),
    top:clamp(rect?.top ?? height+inset-h,inset,height+inset-h)
  }
}

function adjusted(start, action, dx, dy, area) {
  if (action === 'move') return fit({...start,left:start.left+dx,top:start.top+dy},area)
  const {inset,width,height,minWidth,minHeight} = area
  let {left,top} = start, right = left+start.width, bottom = top+start.height
  if (action.includes('w')) left = clamp(left+dx,inset,right-minWidth)
  if (action.includes('n')) top = clamp(top+dy,inset,bottom-minHeight)
  if (action.includes('e')) right = clamp(right+dx,left+minWidth,inset+width)
  if (action.includes('s')) bottom = clamp(bottom+dy,top+minHeight,inset+height)
  return {left,top,width:right-left,height:bottom-top}
}

export function useChatLayout(React, mode) {
  const ref = React.useRef(null), gesture = React.useRef(null), preferred = React.useRef(null)
  const [rect,setRect] = React.useState(null)
  const storageKey = 'moki-library.chat-layout.'+mode
  function remember(next) {
    preferred.current = next
    try { localStorage.setItem(storageKey,JSON.stringify(next)) } catch {}
  }
  React.useLayoutEffect(()=>{
    if(!mode)return
    const panel = ref.current.parentElement
    preferred.current = null
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey))
      if (saved && ['top','left','width','height'].every(k=>Number.isFinite(saved[k])) && saved.width>0 && saved.height>0) preferred.current=saved
    } catch {}
    const fitPanel = () => { if (panel.clientWidth && panel.clientHeight) setRect(fit(preferred.current,limits(panel))) }
    fitPanel()
    const observer = new ResizeObserver(fitPanel)
    observer.observe(panel)
    return () => { observer.disconnect(); delete panel.dataset.chatGesture; gesture.current=null }
  },[mode])

  function handle(action) {
    return {
      onPointerDown(event) {
        if (event.button !== 0 || !event.isPrimary || !rect) return
        event.preventDefault()
        const panel=ref.current.parentElement
        gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,start:rect,latest:rect}
        panel.dataset.chatGesture=action
        event.currentTarget.setPointerCapture(event.pointerId)
      },
      onPointerMove(event) {
        const current=gesture.current
        if (!current || current.id!==event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return
        current.latest=adjusted(current.start,action,event.clientX-current.x,event.clientY-current.y,limits(ref.current.parentElement))
        setRect(current.latest)
      },
      onLostPointerCapture(event) {
        const current=gesture.current
        if (!current || current.id!==event.pointerId) return
        delete ref.current.parentElement.dataset.chatGesture
        remember(current.latest)
        gesture.current=null
      },
      onKeyDown(event) {
        if (!rect || !Object.hasOwn(directions,event.key)) return
        event.preventDefault(); event.stopPropagation()
        const [x,y]=directions[event.key], step=event.shiftKey?32:8, area=limits(ref.current.parentElement)
        const next=action==='move' ? adjusted(rect,action,x*step,y*step,area)
          : fit({...rect,width:rect.width+x*step,height:rect.height+y*step},area)
        setRect(next); remember(next)
      }
    }
  }
  return {ref,style:rect??undefined,handle}
}
