import {createFramePool} from './client-frames.js'
import {registerPanels} from './client-panel.js'
import {createChatComponents} from './client-chat.js'
import {registerPreviewChat} from './client-preview-chat.js'
import {drawLibraryMark,smallLibraryMark} from './library-mark.js'
import {librarySettings} from './client-settings.js'
import {registerComposerActions} from './client-picker.js'
import {selectionQuote as quote} from './selection-context.js'
import {setLocale,getLocale,subscribeLocale} from './i18n.js'
import {watchLibraryLanguage} from './preferences.mjs'
import css from './client-shell.css'
window.__ModuleLoader__.load({
  id:'dsh-moki-library',
  factory(require) {
    const React=require('react'), h=React.createElement
    const ui=require('@deepseek-ai/dsh-client-ui-primitives')
    const {Chat, Conversation, useChatBinding}=createChatComponents(React,ui,require('react-dom'),require('@deepseek-ai/dsh-client-ui-conversation').conversationPhase)
    const kind='moki-library', type='dsh-moki-library/catalog'
    const views=new Map(), listeners=new Set()
    const {size,strokeWidth,books,bands}=drawLibraryMark(smallLibraryMark)
    function Icon(){
      return h('svg',{width:17,height:17,viewBox:`0 0 ${size} ${size}`,fill:'none',stroke:'currentColor',strokeWidth,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
        books.map(book=>h('rect',{key:book.x,...book})),h('path',{d:bands}))
    }
    function isDark(){return getComputedStyle(document.documentElement).colorScheme==='dark'||document.body.hasAttribute('data-ds-dark-theme')||document.documentElement.dataset.colorScheme==='dark'}
    function publish(id,value){if(value)views.set(id,value);else views.delete(id);for(const l of listeners)l()}
    function subscribe(l){listeners.add(l);return ()=>listeners.delete(l)}
    const PreviewQuote=React.createContext(null)
    function useCatalogQuote(sessionId){
      return React.useSyncExternalStore(subscribe,()=>views.get(sessionId)||null)
    }
    function usePreviewQuote(sessionId){
      const state=React.useContext(PreviewQuote)
      return state?.sessionId===sessionId ? state : null
    }
    return {
      inject:['slots','sidebarRight','sidebarRightTabs','layout','uiWorkspace','workspaces','sessions','conversation','uiConversation','uiSession','fileDrag','locale','configForms'],
      apply(ctx){
        const settings=librarySettings(ctx,React,require('react-dom').createPortal,Icon,ui)
        ctx.effect(()=>watchLibraryLanguage(ctx.locale,settings.form,setLocale),'moki-library: interface language')
        const popup=window.parent!==window && /^#moki-preview-chat=([a-f0-9-]{36})$/.exec(location.hash)
        registerComposerActions(ctx,React,{...settings,Icon,ui,useQuote:popup?usePreviewQuote:useCatalogQuote})
        if(popup){registerPreviewChat(ctx,React,{key:popup[1],Chat,Conversation,useChatBinding,quote,QuoteContext:PreviewQuote,css,createPortal:require('react-dom').createPortal});return}
        const ns='mokiLibrary',labels={zh:{title:'MOKI资料库',open:'打开 MOKI资料库',guide:'管理文件、链接和文件夹，与 DSH 协同编辑。'},en:{title:'MOKI Library',open:'Open MOKI Library',guide:'Manage materials and edit with DSH.'}}
        ctx.effect(()=>{
          let release=()=>{}
          const update=()=>{
            release()
            const selected=labels[getLocale()]
            // Only this plugin's namespace changes; DSH keeps its own language.
            release=ctx.locale.register(ns,{zh:selected,en:selected})
          }
          const unsubscribe=subscribeLocale(update)
          update()
          return ()=>{unsubscribe();release()}
        },'moki-library: locale')
        const t=ctx.locale.bind(ns)
        ctx.effect(()=>ctx.sidebarRightTabs.register({id:type,kind,title:()=>t('title'),keepMounted:true,guide:[{id:kind,order:24,title:()=>t('title'),description:()=>t('guide'),icon:Icon}]}),'moki-library: tab')
        const pool = createFramePool(isDark,ctx,quote,settings.form)
        ctx.effect(()=>()=>pool.dispose(),'moki-library: open documents')
        registerPanels(ctx,React,{Icon,Chat,Conversation,useChatBinding,quote,publish,views,pool,css,kind,type,t,ui,SettingsButton:settings.SettingsButton})
      }
    }
  }
})
