const selectionType = 'application/x-moki-library-selection'

function collect(entry, token) {
  const channel = new MessageChannel()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      channel.port1.close()
      reject(new Error('读取拖动的资料超时'))
    }, 60000)
    channel.port1.onmessage = ({data}) => {
      clearTimeout(timer)
      channel.port1.close()
      if (data.error) reject(new Error(data.error))
      else resolve(data.value)
    }
    entry.frame.contentWindow.postMessage({type:'collect-drag', bridge:entry.bridge, token}, entry.origin, [channel.port2])
  })
}

// Library chrome and the native conversation live in separate origins. Only
// the active source knows this gesture's token. Route to the actual drop seat.
export function installLibraryDrag(ctx, update, quote) {
  let source, highlighted, retirement
  const targets = new Map()
  function retire() {
    clearTimeout(retirement)
    for (const {overlay} of targets.values()) overlay.remove()
    targets.clear()
    source = undefined
    highlight(null)
  }
  function start(entry,token) {
    retire()
    source = {entry,token}
    retirement=setTimeout(retire,120000)
    const style = getComputedStyle(document.body)
    for (const card of document.querySelectorAll('[data-conversation-session] [data-composer-card]')) {
      const bounds = card.getBoundingClientRect()
      if (!bounds.width || !bounds.height || !card.querySelector('input[type=file]:not(:disabled)')) continue
      const hit=document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+bounds.height/2)
      if (!card.contains(hit)) continue
      const overlay = document.createElement('iframe')
      overlay.className='ml-chat-drop-target'
      overlay.title='拖入资料到 DSH 对话'
      overlay.tabIndex=-1
      overlay.setAttribute('aria-hidden','true')
      Object.assign(overlay.style,{left:bounds.left+'px',top:bounds.top+'px',width:bounds.width+'px',height:bounds.height+'px'})
      const url = new URL('./drag-target.html',entry.frame.src)
      url.hash=new URLSearchParams({token,parent:location.origin,accent:style.getPropertyValue('--dsw-alias-link').trim()||'Highlight',fill:style.getPropertyValue('--dsw-alias-button-floating-fill').trim()||'Canvas',text:style.color})
      overlay.src=url.href
      document.body.append(overlay)
      targets.set(overlay.contentWindow,{card,overlay})
    }
  }
  function highlight(card) {
    if (highlighted === card) return
    highlighted?.removeAttribute('data-ml-drop')
    highlighted = card
    if (card) card.dataset.mlDrop = ''
  }
  const clear = () => highlight(null)
  function targetOf(event) {
    if (!source?.entry.host || !event.dataTransfer?.types.includes(selectionType)) return
    const surface = event.target.closest?.('[data-conversation-content][data-conversation-session]')
    return surface?.querySelector('[data-composer-card]')
  }
  function dragOver(event) {
    const card = targetOf(event)
    highlight(card)
    if (!card) return
    event.preventDefault()
    event.dataTransfer.dropEffect = card.querySelector('input[type=file]:not(:disabled)') ? 'copy' : 'none'
  }
  function dragLeave(event) {
    if (highlighted && !highlighted.closest('[data-conversation-content]')?.contains(event.relatedTarget)) clear()
  }
  async function accept(card) {
    const {entry,token} = source
    const id = card.closest('[data-conversation-session]').dataset.conversationSession
    const ref = ctx.sessions.retain(id, {source:'moki-library'})
    retire()
    try {
      const [{files,references,asReference}] = await Promise.all([collect(entry, token), ref.ready])
      const fileInput = card.querySelector('input[type=file]')
      if (!card.isConnected || card.closest('[data-conversation-session]')?.dataset.conversationSession !== id || !fileInput || fileInput.disabled) throw new Error('目标对话已切换或暂时无法添加资料，请重试')
      const actions = ctx.uiSession.adapter.bindingSource(ref).getSnapshot().props.inputActions
      if (references.length) {
        const selection = {label:references.map(item => item.name).join('、'), content:JSON.stringify({selectedItems:references})}
        if (!actions.insertQuote(quote(selection))) throw new Error('当前对话暂时无法接收资料')
        actions.persistDraft()
      }
      if (files.length) {
        const transfer = new DataTransfer()
        for (const file of files) transfer.items.add(file)
        fileInput.files = transfer.files
        fileInput.dispatchEvent(new Event('change', {bubbles:true}))
      }
      card.querySelector('[data-composer-input]')?.focus({preventScroll:true})
      if (asReference.length) update(entry,{notice:'以下文件以资料库引用加入：'+asReference.join('、')})
    } catch (error) { update(entry,{notice:error.message}) }
    finally { ref.release() }
  }
  function drop(event) {
    const card = targetOf(event)
    clear()
    if (!card || event.dataTransfer.getData(selectionType) !== source.token) return
    event.preventDefault()
    event.stopImmediatePropagation()
    void accept(card)
  }
  function receive(event) {
    const target=targets.get(event.source)
    if (target && source?.entry.host && event.origin===source.entry.origin && event.data?.type==='library-chat-drop' && event.data.token===source.token && target.card.isConnected) void accept(target.card)
  }
  window.addEventListener('message',receive)
  document.addEventListener('dragover', dragOver, true)
  document.addEventListener('dragleave', dragLeave, true)
  document.addEventListener('drop', drop, true)
  window.addEventListener('dragend', clear)
  window.addEventListener('blur', clear)
  return {
    start,
    end(entry,token) {
      if (source?.entry !== entry || source.token !== token) return
      clearTimeout(retirement)
      retirement=setTimeout(retire,140)
    },
    detach(entry) { if (source?.entry === entry) retire() },
    dispose() {
      retire()
      window.removeEventListener('message',receive)
      document.removeEventListener('dragover', dragOver, true)
      document.removeEventListener('dragleave', dragLeave, true)
      document.removeEventListener('drop', drop, true)
      window.removeEventListener('dragend', clear)
      window.removeEventListener('blur', clear)
    }
  }
}
