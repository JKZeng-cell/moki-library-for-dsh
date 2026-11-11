import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";

export async function patchViewer(artifacts) {
const viewerPath = join(artifacts,"viewer/index.html");
const startMarker = "<!-- moki-univer-bridge:start -->";
const endMarker = "<!-- moki-univer-bridge:end -->";
const injection = `${startMarker}
    <style>
      html[data-dsh-theme] { color-scheme: var(--moki-scheme) !important; }
      html[data-dsh-theme] [role="toolbar"] { background-color:var(--moki-toolbar)!important; border-color:var(--moki-border)!important; }
      html[data-dsh-theme] .shell { background:var(--moki-surface); color:var(--moki-label); }
      [data-moki-editor-menu="true"] {
        z-index: 2147483000 !important;
      }
      [data-moki-editor-font-menu="true"] {
        box-sizing: border-box !important;
        width: min(290px, calc(100vw - 24px)) !important;
        min-width: min(240px, calc(100vw - 24px)) !important;
        max-width: min(290px, calc(100vw - 24px)) !important;
        max-height: min(360px, calc(100vh - 112px)) !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
      }
      [data-moki-editor-menu-panel="true"] {
        border: 0 !important;
        outline: 0 !important;
        border-radius: 12px !important;
        background: var(--moki-popover, Canvas) !important;
        color:var(--moki-label, CanvasText);
        box-shadow:
          0 28px 36px -24px rgba(47, 51, 74, .52),
          0 18px 30px -24px rgba(105, 96, 202, .38),
          0 7px 16px -12px rgba(45, 49, 69, .16) !important;
      }
      [data-moki-editor-insert-menu="true"] {
        box-sizing: border-box !important;
        width: min(280px, calc(100vw - 24px)) !important;
        min-width: min(280px, calc(100vw - 24px)) !important;
        max-width: min(280px, calc(100vw - 24px)) !important;
        overflow-x: hidden !important;
      }
      [data-moki-editor-menu-panel="true"] [data-moki-editor-menu-panel="true"] {
        border: 0 !important;
        box-shadow: none !important;
      }
      [data-radix-popper-content-wrapper],
      [data-moki-editor-menu-layer="true"] {
        z-index: 2147483000 !important;
        pointer-events: auto !important;
      }
      [data-moki-hide-file-action="true"] { display: none !important; }
      [data-moki-media-source-menu="true"] {
        position: fixed;
        z-index: 2147483640;
        box-sizing: border-box;
        width: 188px;
        padding: 6px;
        border: 1px solid var(--moki-border, ButtonBorder);
        border-radius: 8px;
        background: var(--moki-popover, Canvas);
        box-shadow: 0 18px 40px -22px rgba(39, 43, 64, .48), 0 8px 20px -14px rgba(98, 91, 197, .28);
      }
      [data-moki-media-source-menu="true"] button {
        display: flex;
        width: 100%;
        min-height: 36px;
        align-items: center;
        gap: 9px;
        padding: 0 10px;
        border: 0;
        border-radius: 9px;
        background: transparent;
        color: var(--moki-label, CanvasText);
        font: 600 12px/1.4 system-ui, sans-serif;
        text-align: left;
        cursor: pointer;
      }
      [data-moki-media-source-menu="true"] button:hover { background: var(--moki-hover, ButtonFace); }
      [data-moki-media-source-menu="true"] button + button { margin-top: 2px; }
    </style>
    <script>
      (() => {
        let pointer = { x: 24, y: 72 };
        let lastUserEditIntentAt = 0;
        let retainedSlideTextSelection = null;
        const slideEditingBaselines = new WeakMap();
        const rememberUserEditIntent = () => { lastUserEditIntentAt = Date.now(); };
        const findEditorService = (unit, matches) => {
          const rootInjector = unit?._injector;
          if (!rootInjector) return null;
          const queue = [rootInjector];
          const seen = new Set();
          while (queue.length) {
            const injector = queue.shift();
            if (!injector || seen.has(injector)) continue;
            seen.add(injector);
            const dependencies = injector.resolvedDependencyCollection?.resolvedDependencies;
            if (dependencies instanceof Map) {
              for (const values of dependencies.values()) {
                for (const value of Array.isArray(values) ? values : [values]) {
                  if (matches(value)) return value;
                }
              }
            }
            if (injector.parent) queue.push(injector.parent);
            for (const child of injector.children || []) queue.push(child);
          }
          return null;
        };
        const activeDocumentSelection = (doc) => {
          if (!doc) return null;
          const selectionManager = findEditorService(doc, value => typeof value?.getActiveTextRange === "function" && typeof value?.getDocRanges === "function");
          const owner = selectionManager?.__getCurrentSelection?.();
          if (owner?.unitId && owner.unitId !== doc.getId()) return null;
          const range = selectionManager?.getActiveTextRange?.();
          if (!range || !Number.isInteger(range.startOffset) || !Number.isInteger(range.endOffset)) return null;
          const startOffset = Math.min(range.startOffset, range.endOffset);
          const endOffset = Math.max(range.startOffset, range.endOffset);
          const segmentId = typeof range.segmentId === "string" ? range.segmentId : "";
          let selectedText = "";
          if (endOffset > startOffset) {
            try {
              selectedText = String(doc.getTextRange(startOffset, endOffset, segmentId).getText() || "").slice(0, 8000);
            } catch {
              selectedText = "";
            }
          }
          return {
            kind: "document",
            unitId: String(doc.getId?.() || ""),
            startOffset,
            endOffset,
            collapsed: endOffset === startOffset,
            segmentId,
            // Layout positions are zero based; user-facing page/line numbers are not.
            page: Number.isInteger(range.startNodePosition?.page) ? range.startNodePosition.page + 1 : null,
            line: Number.isInteger(range.startNodePosition?.line) ? range.startNodePosition.line + 1 : null,
            selectedText,
          };
        };
        const activeSlideSelection = (presentation) => {
          const slide = presentation && typeof presentation.getActiveSlide === "function" ? presentation.getActiveSlide() : null;
          if (!presentation || !slide) return null;
          const unitId = String(presentation.getId?.() || ""), slideId = String(slide.getId?.() || "");
          const stateService = findEditorService(presentation, value => typeof value?.selectDrawings === "function" && typeof value?.getSnapshot === "function" && typeof value?.setActiveEditing === "function");
          const state = stateService?.getSnapshot?.();
          const selectedIds = state?.context?.unitId === unitId && state?.context?.subUnitId === slideId ? state.selectedIds || [] : [];
          const data = slide.getData?.();
          const elements = selectedIds.slice(0, 25).map(id => {
            const element = data?.elements?.[id];
            if (!element) return null;
            const shapeText = element.shapeData?.shapeText;
            const text = String(shapeText?.dataModel?.doc?.body?.dataStream || shapeText?.text || "").replace(/[\\r\\n]+$/, "");
            return { id, name: String(element.name || "").slice(0, 256), type: element.type, transform: element.transform, text: text.slice(0, 8000) };
          }).filter(Boolean);
          const editingService = findEditorService(presentation, value => typeof value?.startEditingDrawing === "function" && typeof value?.getEditing === "function");
          const editing = editingService?.getEditing?.();
          let textSelection, selectedText = elements.map(element => element.text).filter(Boolean).join("\\n");
          // The slide text editor is an internal document. Only use its range
          // when it belongs to the selected shape on this exact presentation/page.
          if (editing?.visible && editing.unitId === unitId && editing.subUnitId === slideId && selectedIds.includes(editing.shapeId)) {
            const doc = window.univerAPI?.getActiveDocument?.();
            if (doc?.getId?.() === editing.initialDocData?.id) {
              const range = activeDocumentSelection(doc);
              if (range) {
                textSelection = { elementId: editing.shapeId, startOffset: range.startOffset, endOffset: range.endOffset, segmentId: range.segmentId, collapsed: range.collapsed, indexUnit: "utf16", scope: "shape-text" };
                selectedText = range.selectedText;
              }
            }
          }
          const retained = retainedSlideTextSelection;
          if (!textSelection && retained?.unitId === unitId && retained.slideId === slideId && selectedIds.length === 1 && selectedIds[0] === retained.textSelection.elementId) {
            const element = elements.find(element => element.id === retained.textSelection.elementId);
            if (element?.text === retained.bodyText) {
              textSelection = retained.textSelection;
              selectedText = retained.selectedText;
            } else retainedSlideTextSelection = null;
          }
          return {
            kind: "slide",
            unitId, slideId,
            page: presentation.getSlides().findIndex(page => page.getId() === slideId) + 1,
            slideName: String(slide.getName?.() || "").slice(0, 256),
            selectedElementIds: elements.map(element => element.id), elements, textSelection,
            selectedText: selectedText.slice(0, 8000), truncated: selectedIds.length > 25 || selectedText.length > 8000,
          };
        };
        const activeSheetSelection = (workbook) => {
          const sheet = workbook && typeof workbook.getActiveSheet === "function" ? workbook.getActiveSheet() : null;
          if (!workbook || !sheet) return null;
          const current = sheet.getActiveRange?.();
          const range = current?.getRange?.();
          const address = current?.getA1Notation?.();
          if (!range || !address) return null;
          const ranges = sheet.getSelection?.()?.getActiveRangeList?.().map(item => item.getA1Notation()) || [];
          let values=[],formulas=[];
          const rows=Math.min(50,range.endRow-range.startRow+1),columns=Math.min(20,range.endColumn-range.startColumn+1);
          try{const bounded=sheet.getRange(range.startRow,range.startColumn,rows,columns);values=bounded.getValues().map(row=>row.map(value=>String(value??'').slice(0,500)));formulas=bounded.getFormulas().map(row=>row.map(value=>String(value??'').slice(0,500)))}catch{}
          return {
            kind: "sheet",
            unitId: String(workbook.getId?.() || ""),
            sheetId: String(sheet.getSheetId?.() || ""),
            sheetName: sheet.getSheetName?.() || "",
            range: address,
            ranges: ranges.length ? ranges : [address],
            row: range.startRow, column: range.startColumn,
            endRow: range.endRow, endColumn: range.endColumn,
            values,formulas,selectedText:values.map(row=>row.join('\\t')).join('\\n').slice(0,8000),truncated:rows<range.endRow-range.startRow+1||columns<range.endColumn-range.startColumn+1,
          };
        };
        const activeBoardSelection = (board) => {
          if (!board) return null;
          return {
            kind: "board",
            unitId: String(board.getId?.() || ""),
            pageId: String(board.getActivePageId?.() || ""),
          };
        };
        const activeEditorSelection = () => {
          const api = window.univerAPI;
          if (!api) return null;
          // Sheets also exposes the formula input as an active document. Its
          // caret belongs to Univer's internal editor, not the user's workbook.
          const units = [
            [api.getActiveWorkbook?.(), activeSheetSelection],
            [api.getActivePresentation?.(), activeSlideSelection],
            [api.getActiveDocument?.(), activeDocumentSelection],
            [api.getActiveBoard?.(), activeBoardSelection],
          ].filter(([unit]) => unit?.getId?.() && !unit.getId().startsWith("__INTERNAL_"));
          const focused = api._univerInstanceService?.getFocusedUnit?.();
          const focusedId = typeof focused === "string" ? focused : focused?.getUnitId?.();
          const shownId = new URLSearchParams(window.location.search).get("unit");
          const chosen = units.find(([unit]) => unit.getId() === focusedId)
            || units.find(([unit]) => unit.getId() === shownId)
            || (units.length === 1 ? units[0] : null);
          return chosen ? chosen[1](chosen[0]) : null;
        };
        const finishSlideTextEditing = () => {
          const presentation = window.univerAPI?.getActivePresentation?.();
          if (!presentation) return false;
          const service = findEditorService(presentation, value => typeof value?.startEditingDrawing === "function" && typeof value?.getEditing === "function");
          const editing = service?.getEditing?.();
          if (!editing?.visible || editing.unitId !== presentation.getId()) return false;
          const selection = activeSlideSelection(presentation);
          const doc = window.univerAPI.getActiveDocument?.();
          if (doc?.getId?.() !== editing.initialDocData?.id) return false;
          if (selection?.textSelection) retainedSlideTextSelection = {
            unitId: selection.unitId, slideId: selection.slideId, textSelection: selection.textSelection,
            selectedText: selection.selectedText,
            bodyText: String(doc.getBody()?.dataStream || "").replace(/[\\r\\n]+$/, ""),
          };
          // Close the live text overlay before handing control to the agent.
          // Otherwise its unmount can commit an old snapshot over a remote edit.
          // A selection alone must not trigger the editor's automatic resizing.
          if (JSON.stringify(doc.getBody()) === (slideEditingBaselines.get(editing) || JSON.stringify(editing.initialDocData?.body))) service.cancelEditing();
          else service.completeEditing();
          return true;
        };
        document.addEventListener("pointerdown", (event) => {
          retainedSlideTextSelection = null;
          pointer = { x: event.clientX, y: event.clientY };
          rememberUserEditIntent();
        }, true);
        document.addEventListener("beforeinput", rememberUserEditIntent, true);
        let selectionTimer,selectionSignature='';
        const publishSelection=()=>{clearTimeout(selectionTimer);selectionTimer=setTimeout(()=>{try{const selection=activeEditorSelection(),signature=JSON.stringify(selection);if(!selection||signature===selectionSignature)return;selectionSignature=signature;window.parent.postMessage({type:'moki:univer-selection-changed',selection},'*')}catch{}},100)};
        document.addEventListener('pointerup',publishSelection,true);
        document.addEventListener('keyup',publishSelection,true);
        document.addEventListener('selectionchange',publishSelection);
        document.addEventListener("paste", rememberUserEditIntent, true);
        document.addEventListener("cut", rememberUserEditIntent, true);
        document.addEventListener("drop", rememberUserEditIntent, true);
        window.addEventListener("blur", () => { if (finishSlideTextEditing()) publishSelection(); });
        document.addEventListener("keydown", async (event) => {
          rememberUserEditIntent();
          if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing || (event.code !== "KeyD" && event.key.toLowerCase() !== "d")) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          const active = document.activeElement;
          const rect = active instanceof HTMLElement ? active.getBoundingClientRect() : null;
          const editorSelection = activeEditorSelection();
          if (finishSlideTextEditing()) await waitForEditorSync();
          window.parent.postMessage({
            type: "moki:univer-compose-shortcut",
            x: rect && rect.width ? rect.left + Math.min(rect.width, 24) : pointer.x,
            y: rect && rect.height ? rect.top + Math.min(rect.height, 24) : pointer.y,
            selectedText: editorSelection?.selectedText || String(document.getSelection()?.toString() || "").slice(0, 8000),
            editorSelection,
          }, "*");
        }, true);

        let commandListenerBound = false;
        let requestedScheme;
        function syncScheme() {
          const api = window.univerAPI;
          if (requestedScheme === undefined || typeof api?.toggleDarkMode !== "function") return;
          if (api.isDarkMode() !== requestedScheme) api.toggleDarkMode(requestedScheme);
        }
        const bindCommandListener = () => {
          syncScheme();
          if (commandListenerBound) return true;
          const api = window.univerAPI;
          const eventName = api?.Event?.CommandExecuted;
          const mutationType = api?.Enum?.CommandType?.MUTATION;
          if (!api || typeof api.addEvent !== "function" || !eventName || mutationType === undefined) return false;
          api.addEvent(eventName, ({ id, type, options } = {}) => {
            // The internal document adds paragraph/layout defaults at startup.
            // Capture the normalized body on its initial caret event, before
            // any typing or formatting, to distinguish selection from edits.
            if (id === "doc.operation.set-selections") {
              const presentation = api.getActivePresentation?.();
              const editing = presentation && findEditorService(presentation, value => typeof value?.startEditingDrawing === "function" && typeof value?.getEditing === "function")?.getEditing?.();
              const doc = api.getActiveDocument?.();
              if (editing && doc?.getId?.() === editing.initialDocData?.id && !slideEditingBaselines.has(editing)) slideEditingBaselines.set(editing, JSON.stringify(doc.getBody()));
            }
            // Remote changes and formula results must refresh the selected values
            // even while focus stays in the DSH conversation.
            if (type === mutationType) publishSelection();
            // This is the same persisted-mutation boundary recommended by the
            // Univer facade for collaboration. View-only and remote worktree
            // updates must not make an untouched editor look unsaved.
            if (type !== mutationType || options?.fromCollab || options?.onlyLocal || id === "doc.mutation.rich-text-editing") return;
            if (Date.now() - lastUserEditIntentAt > 30_000) return;
            window.parent.postMessage({ type: "moki:univer-dirty" }, "*");
          });
          commandListenerBound = true;
          return true;
        };
        const commandListenerTimer = window.setInterval(() => {
          if (bindCommandListener()) window.clearInterval(commandListenerTimer);
        }, 100);
        bindCommandListener();

        const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const waitForEditorSync = async () => {
          finishSlideTextEditing();
          const active = document.activeElement;
          if (active instanceof HTMLElement) active.blur();
          // Univer persists canvas edits through a debounced worktree update. Give
          // the debounce a chance to start before accepting an already-visible
          // "synced" badge from the previous revision.
          await sleep(900);
          const deadline = Date.now() + 8_000;
          let quietSince = 0;
          while (Date.now() < deadline) {
            const labels = [...document.querySelectorAll('[role="status"]')]
              .map((element) => (element.textContent || "").trim())
              .filter(Boolean)
              .join(" ");
            const syncing = /同步中|正在同步|保存中|syncing|saving/iu.test(labels);
            // Slides expose only the local-file badge and no explicit
            // "synced" status. After the debounce delay, a stable absence of
            // any syncing/saving signal is the reliable ready condition for
            // all three Office editors.
            if (!syncing) {
              if (!quietSince) quietSince = Date.now();
              if (Date.now() - quietSince >= 300) return true;
            } else {
              quietSince = 0;
            }
            await sleep(80);
          }
          return false;
        };
        window.addEventListener("message", async (event) => {
          if (event.source !== window.parent || !event.data) return;
          if (event.data.type === "moki:univer-theme" && typeof event.data.dark === "boolean") {
            requestedScheme = event.data.dark;
            const root = document.documentElement;
            root.dataset.dshTheme = requestedScheme ? "dark" : "light";
            root.style.setProperty("--moki-scheme",root.dataset.dshTheme);
            for (const name of ["surface","toolbar","border","label","popover","hover"]) {
              const value = event.data.colors?.[name];
              if (typeof value === "string" && CSS.supports("color",value)) root.style.setProperty("--moki-"+name,value);
            }
            syncScheme();
            return;
          }
          const requestId = typeof event.data.requestId === "string" ? event.data.requestId : "";
          if (!requestId) return;
          if (event.data.type === "moki:univer-prepare-save") {
            const synced = await waitForEditorSync();
            window.parent.postMessage({ type: "moki:univer-save-ready", requestId, synced }, "*");
            return;
          }
          if (event.data.type === "moki:univer-selection-request") {
            window.parent.postMessage({
              type: "moki:univer-selection-response",
              requestId,
              selection: activeEditorSelection(),
            }, "*");
            return;
          }
        });

        let mediaSourceMenu = null;
        const nativeImageActionBypass = new WeakSet();
        const closeMediaSourceMenu = () => {
          mediaSourceMenu?.remove();
          mediaSourceMenu = null;
        };
        const imageActionMetadata = (action) => [
          action.getAttribute("aria-label") || "",
          action.getAttribute("title") || "",
          action.getAttribute("data-u-command") || "",
          action.textContent || "",
        ].join(" ").replace(/\\s+/g, " ").trim();
        const isNativeImageInsertAction = (action) => {
          if (!(action instanceof HTMLElement) || action.closest('[data-moki-media-source-menu="true"]')) return false;
          if (!action.closest('[role="toolbar"], [role="menu"], [data-moki-editor-menu="true"]')) return false;
          const metadata = imageActionMetadata(action);
          if (!/(插入图片|添加图片|insert[ -]?image|image[ -]?insert)/iu.test(metadata)
            && !(/^(图片|image)$/iu.test(metadata))) return false;
          return !/(删除|移除|替换|裁剪|格式|填充|delete|remove|replace|crop|format|fill)/iu.test(metadata);
        };
        const openMediaSourceMenu = (action) => {
          closeMediaSourceMenu();
          const bounds = action.getBoundingClientRect();
          const menu = document.createElement("div");
          menu.setAttribute("data-moki-media-source-menu", "true");
          menu.setAttribute("role", "menu");
          menu.setAttribute("aria-label", "插入图片来源");
          const left = Math.max(8, Math.min(window.innerWidth - 196, bounds.left));
          const below = bounds.bottom + 6;
          const top = below + 88 <= window.innerHeight ? below : Math.max(8, bounds.top - 88);
          menu.style.left = left + "px";
          menu.style.top = top + "px";
          const local = document.createElement("button");
          local.type = "button";
          local.setAttribute("role", "menuitem");
          local.textContent = "本地图片";
          local.addEventListener("click", () => {
            closeMediaSourceMenu();
            nativeImageActionBypass.add(action);
            action.click();
          });
          const library = document.createElement("button");
          library.type = "button";
          library.setAttribute("role", "menuitem");
          library.setAttribute("data-moki-library-media-trigger", "true");
          library.textContent = "资料库图片";
          library.addEventListener("click", () => {
            closeMediaSourceMenu();
            window.parent.postMessage({
              type: "moki:univer-open-library-media",
              mediaKind: "image",
              selection: activeEditorSelection(),
            }, "*");
          });
          menu.append(local, library);
          document.body.append(menu);
          mediaSourceMenu = menu;
        };
        document.addEventListener("click", (event) => {
          const action = event.target instanceof Element ? event.target.closest("button, [role='button']") : null;
          if (!action || !isNativeImageInsertAction(action)) return;
          if (nativeImageActionBypass.delete(action)) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          openMediaSourceMenu(action);
        }, true);
        document.addEventListener("pointerdown", (event) => {
          if (!mediaSourceMenu || (event.target instanceof Node && mediaSourceMenu.contains(event.target))) return;
          closeMediaSourceMenu();
        }, true);

        let scheduled = false;
        const markEditorChrome = () => {
          scheduled = false;
          for (const toolbar of document.querySelectorAll('[role="toolbar"]')) {
            for (const element of toolbar.querySelectorAll("button, [role='button'], span, div")) {
              const label = (element.textContent || "").trim();
              if (label !== "文件" && label !== "File") continue;
              const action = element.closest("button, [role='button']") || element;
              action.setAttribute("data-moki-hide-file-action", "true");
            }
          }
          const markMenu = (menu, insertMenu = false) => {
            menu.setAttribute("data-moki-editor-menu", "true");
            const labelledBy = menu.getAttribute("aria-labelledby");
            const menuTrigger = labelledBy ? document.getElementById(labelledBy) : null;
            if (menuTrigger?.getAttribute("data-u-command")?.includes("font-family")) {
              menu.setAttribute("data-moki-editor-font-menu", "true");
            } else {
              menu.removeAttribute("data-moki-editor-font-menu");
            }
            const ownPanel = menu.matches('[class*="rounded"][class*="shadow"], [class*="rounded"][class*="overflow"]')
              ? menu
              : undefined;
            const ancestorPanel = menu.parentElement?.closest(
              'div[class*="rounded"][class*="shadow"], div[class*="rounded"][class*="overflow"]',
            );
            const childPanel = menu.querySelector(
              ':scope > [class*="rounded"][class*="shadow"], :scope > [class*="rounded"][class*="overflow"]',
            );
            const visualPanel = ownPanel || ancestorPanel || childPanel || menu;
            if (visualPanel !== menu) {
              menu.removeAttribute("data-moki-editor-menu-panel");
              menu.removeAttribute("data-moki-editor-insert-menu");
            }
            visualPanel.setAttribute("data-moki-editor-menu-panel", "true");
            if (insertMenu) visualPanel.setAttribute("data-moki-editor-insert-menu", "true");
            const layer = menu.closest('[data-radix-popper-content-wrapper], [data-u-context-menu-submenu="true"]') || menu.parentElement;
            layer?.setAttribute("data-moki-editor-menu-layer", "true");
          };
          for (const menu of document.querySelectorAll('[role="menu"], [data-radix-menu-content], [data-u-context-menu-submenu="true"]')) {
            markMenu(menu);
          }
          for (const panel of document.querySelectorAll('div[tabindex="-1"]')) {
            const text = (panel.textContent || "").replace(/\\s+/g, "");
            if (!text.includes("对齐和缩进") || !text.includes("在下方插入")) continue;
            const bounds = panel.getBoundingClientRect();
            if (bounds.width >= 160 && bounds.width <= 360 && bounds.height >= 180 && bounds.height <= 640) {
              markMenu(panel);
            }
          }
          for (const element of document.querySelectorAll("div")) {
            const text = (element.textContent || "").replace(/\\s+/g, "");
            if (!text.includes("插入表格") || !text.includes("插入图片")) continue;
            const markedAncestor = element.parentElement?.closest('[data-moki-editor-menu-panel="true"]');
            if (markedAncestor) continue;
            const bounds = element.getBoundingClientRect();
            if (bounds.width >= 140 && bounds.width <= 520 && bounds.height >= 140 && bounds.height <= 760) {
              const nestedCandidate = [...element.children].some((child) => {
                const childText = (child.textContent || "").replace(/\\s+/g, "");
                const childBounds = child.getBoundingClientRect();
                return childText.includes("插入表格") && childText.includes("插入图片")
                  && childBounds.width >= 140 && childBounds.height >= 140;
              });
              if (!nestedCandidate || element.matches('[data-u-context-menu-submenu="true"]')) markMenu(element, true);
            }
          }
        };
        const scheduleMark = () => {
          if (scheduled) return;
          scheduled = true;
          requestAnimationFrame(markEditorChrome);
        };
        new MutationObserver(scheduleMark).observe(document.documentElement, { childList: true, subtree: true });
        document.addEventListener("pointerdown", scheduleMark, true);
        scheduleMark();
      })();
    </script>
    ${endMarker}`;

const source = await readFile(viewerPath, "utf8");
const withoutExisting = source.includes(startMarker)
  ? source.replace(new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`), "")
  : source;
const viewerAssetsDir = join(dirname(viewerPath), "assets");
const viewerModuleName = (await readdir(viewerAssetsDir)).find((name) => /^index-(?!.*-moki-).*\.js$/u.test(name));
if (!viewerModuleName) throw new Error(`Unable to locate the Univer viewer module from ${viewerPath}`);
const viewerModulePath = `/assets/${viewerModuleName}`;
const viewerModuleFile = join(viewerAssetsDir, viewerModuleName);
const viewerModuleSource = await readFile(viewerModuleFile, "utf8");
const worktreeEditGate = "editable:e.view.kind===`trunk`&&e.editable";
const editableDraftGate = "editable:e.editable";
const readOnlyWorktreeSelection = "this.viewPreview?await this.showUnitPreview(e,n):await this.viewer.show(this.view,n,!1)";
const editableWorktreeSelection = "this.viewPreview?await this.showUnitPreview(e,n):await this.viewer.show(this.view,n,this.initEditable===!0)";
let patchedViewerModule = viewerModuleSource;
if (viewerModuleSource.includes(worktreeEditGate)) {
  patchedViewerModule = viewerModuleSource.replace(worktreeEditGate, editableDraftGate);
} else if (!viewerModuleSource.includes(editableDraftGate)) {
  throw new Error(`Unable to enable editable Univer worktrees in ${viewerModuleFile}`);
}
if (patchedViewerModule.includes(readOnlyWorktreeSelection)) {
  patchedViewerModule = patchedViewerModule.replace(readOnlyWorktreeSelection, editableWorktreeSelection);
} else if (!patchedViewerModule.includes(editableWorktreeSelection)) {
  throw new Error(`Unable to pass editable mode into Univer worktree units in ${viewerModuleFile}`);
}
const viewerBoot = "(U2.gatewayFileKey===null?new L2(V2,location.origin,W2,U2.worktreeId,U2.unitId,U2.scope,U2.editable,U2.mode):L2.sameOriginGateway(V2,U2.gatewayFileKey,U2.worktreeId,U2.unitId,U2.scope,U2.editable,U2.mode)).start().catch";
const viewerBootWithBridge = "(window.__mokiUniverApp=U2.gatewayFileKey===null?new L2(V2,location.origin,W2,U2.worktreeId,U2.unitId,U2.scope,U2.editable,U2.mode):L2.sameOriginGateway(V2,U2.gatewayFileKey,U2.worktreeId,U2.unitId,U2.scope,U2.editable,U2.mode)).start().catch";
if (patchedViewerModule.includes(viewerBoot)) {
  patchedViewerModule = patchedViewerModule.replace(viewerBoot, viewerBootWithBridge);
} else if (!patchedViewerModule.includes(viewerBootWithBridge)) {
  throw new Error(`Unable to expose the Univer viewer content bridge in ${viewerModuleFile}`);
}
// Slides are presentation artwork: dark editor chrome must not invert their
// paper, text or explicit fills. Install a color resolver on the slide viewer's
// own render service before loading the unit so cached thumbnails and the live
// text editor use the same original colors. Sheets and documents keep their
// existing theme behavior, and no presentation data is rewritten.
const canvasColorModule = "es-C_3AFWIu.js";
const canvasColorSource = await readFile(join(viewerAssetsDir, canvasColorModule), "utf8");
if (!canvasColorSource.includes("h_ as jD") || !patchedViewerModule.includes("isDarkMode(){return this._injector.get(c_).darkMode}")) {
  throw new Error("Unable to locate the pinned Univer canvas color and theme services");
}
const liveSlideLoad = "else if(e.unitType===3)await c.loadSlideAsync(e.unitId);";
const snapshotSlideLoad = "else if(e.unitType===3){let e=gc(r);i=e.id??``,n.createUnit(k.UNIVER_SLIDE,e)}";
if (!patchedViewerModule.includes(liveSlideLoad) || !patchedViewerModule.includes(snapshotSlideLoad)) {
  throw new Error(`Unable to preserve slide colors before loading the presentation in ${viewerModuleFile}`);
}
patchedViewerModule = `import {jD as mokiCanvasColorService} from "./${canvasColorModule}";
function mokiPreserveSlideColors(univer) {
  const injector = univer.__getInjector();
  const theme = injector.get(c_);
  const canvasColors = injector.get(mokiCanvasColorService);
  canvasColors.getRenderColor = color => theme.isValidThemeColor(color) ? theme.getColorFromTheme(color) : color;
}
` + patchedViewerModule.replace(liveSlideLoad, "else if(e.unitType===3){mokiPreserveSlideColors(a);await c.loadSlideAsync(e.unitId);}")
  .replace(snapshotSlideLoad, "else if(e.unitType===3){mokiPreserveSlideColors(n);let e=gc(r);i=e.id??``,n.createUnit(k.UNIVER_SLIDE,e)}");
const renderPresetName = (await readdir(viewerAssetsDir)).find((name) => /^render-preset-(?!.*-moki-).*\.js$/u.test(name));
if (!renderPresetName) throw new Error(`Unable to locate the Univer render preset in ${viewerAssetsDir}`);
const renderPresetFile = join(viewerAssetsDir, renderPresetName);
const renderPresetSource = await readFile(renderPresetFile, "utf8");
const tableOnlyInsertMenu = "ue=(0,L.useMemo)(()=>n.type!==3||!n.id?[]:r.getMenuByPositionKey(n.id),[n.id,n.type,r,i])";
const documentInsertFallback = "ue=(0,L.useMemo)(()=>{if(n.type!==3||!n.id)return[];let e=r.getMenuByPositionKey(n.id);return n.id===`docs-table-ui.menu.insert`?[...e,...r.getMenuByPositionKey(`doc.menu.paragraph-t.insert`)]:e},[n.id,n.type,r,i])";
let patchedRenderPreset = renderPresetSource;
if (renderPresetSource.includes(tableOnlyInsertMenu)) {
  patchedRenderPreset = renderPresetSource.replace(tableOnlyInsertMenu, documentInsertFallback);
} else if (!renderPresetSource.includes(documentInsertFallback)) {
  throw new Error(`Unable to add the document insert fallback in ${renderPresetFile}`);
}
// The sheet editor uses each reference color for both its text run and range
// outline. Its canvas applies a color matrix in dark mode, including to an edit
// already in progress. Supply canvas source colors that are legible both ways.
const formulaReferenceColors = [
  "#461e7b", "#126046", "#1b518b", "#765700", "#72234e", "#066773",
  "#894716", "#465668", "#373185", "#862a3b", "#465e1b", "#755018",
];
const referenceTokens = Array.from({ length: 12 }, (_, i) => `e.getColorFromTheme(\`loop-color.${i + 1}\`)`);
const sheetReferencePalette = `formulaRefColors:[${referenceTokens.join(",")}].map(t=>e.isValidThemeColor(t)?e.getColorFromTheme(t):t)`;
if (!patchedRenderPreset.includes(sheetReferencePalette)) {
  throw new Error(`Unable to locate the sheet formula reference palette in ${renderPresetFile}`);
}
patchedRenderPreset = patchedRenderPreset.replace(sheetReferencePalette, `formulaRefColors:${JSON.stringify(formulaReferenceColors)}`);
const revision = (value) => createHash("sha256").update(value).digest("hex").slice(0, 12);
const renderRevision = revision(patchedRenderPreset);
const renderPresetPatchedName = renderPresetName.replace(/\.js$/u, `-moki-${renderRevision}.js`);
await writeFile(join(viewerAssetsDir, renderPresetPatchedName), patchedRenderPreset, "utf8");

const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const renderAssetPattern = new RegExp(`${escapePattern(renderPresetName)}(?:\\?moki=[a-f0-9]+)?`, "gu");
const importerNames = (await readdir(viewerAssetsDir)).filter((name) => name.endsWith(".js") && !name.includes("-moki-"));
const importerMap = new Map();
for (const importerName of importerNames) {
  if (importerName === viewerModuleName || importerName === renderPresetName) continue;
  const importerFile = join(viewerAssetsDir, importerName);
  const importerSource = await readFile(importerFile, "utf8");
  if (!renderAssetPattern.test(importerSource)) {
    renderAssetPattern.lastIndex = 0;
    continue;
  }
  renderAssetPattern.lastIndex = 0;
  const importerPatched = importerSource.replace(renderAssetPattern, renderPresetPatchedName);
  const importerPatchedName = importerName.replace(/\.js$/u, `-moki-${revision(importerPatched)}.js`);
  await writeFile(join(viewerAssetsDir, importerPatchedName), importerPatched, "utf8");
  importerMap.set(importerName, importerPatchedName);
}
renderAssetPattern.lastIndex = 0;
patchedViewerModule = patchedViewerModule.replace(renderAssetPattern, renderPresetPatchedName);
for (const [importerName, importerPatchedName] of importerMap) {
  patchedViewerModule = patchedViewerModule.replace(
    new RegExp(`${escapePattern(importerName)}(?:\\?moki=[a-f0-9]+)?`, "gu"),
    importerPatchedName,
  );
}
const viewerRevision = revision(patchedViewerModule);
const viewerModulePatchedName = viewerModuleName.replace(/\.js$/u, `-moki-${viewerRevision}.js`);
await writeFile(join(viewerAssetsDir, viewerModulePatchedName), patchedViewerModule, "utf8");

let next = withoutExisting.replace(
  /(<script\s+type="module"[^>]*>\s*<\/script>|<script\s+type="module"[^>]*><\/script>)/u,
  `${injection}\n    $1`,
);
if (next === withoutExisting) throw new Error(`Unable to patch Univer viewer at ${viewerPath}`);
next = next.replace(
  /src="[^"]*\/assets\/index-[^"]+\.js(?:\?[^"]*)?"/u,
  `src="/assets/${viewerModulePatchedName}"`,
);
next = next.replace(
  /href="\/assets\/render-preset-[^"]+\.js(?:\?[^"]*)?"/u,
  `href="/assets/${renderPresetPatchedName}"`,
);
await writeFile(viewerPath, next, "utf8");

const workerPath = join(artifacts,"unit-content-worker.mjs");
const workerExportSource = `        const unitData = await collaboration.exportUnitData();
        await exportUnit(request, unitData);`;
const workerExportWithAssets = `        const unitData = await collaboration.exportUnitData();
        await inlineGatewayAssetImages(unitData, request);
        await exportUnit(request, unitData);`;
const workerExportAnchor = "async function exportUnit(request, unitData) {";
const workerAssetHelper = `async function inlineGatewayAssetImages(value, request) {
  const references = [];
  const visit = (candidate) => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (typeof candidate !== "object" || candidate === null) return;
    for (const child of Object.values(candidate)) visit(child);
    for (const [sourceKey, typeKey] of [
      ["source", "imageSourceType"],
      ["fillImageSource", "fillImageSourceType"],
      ["source", "sourceType"],
      ["source", "mediaSourceType"],
    ]) {
      if (candidate[typeKey] === "UUID" && typeof candidate[sourceKey] === "string" && candidate[sourceKey].length > 0) {
        references.push({ record: candidate, sourceKey, typeKey, assetId: candidate[sourceKey] });
      }
    }
  };
  visit(value);
  if (references.length === 0) return;
  const root = \`${'${request.gatewayOrigin.replace(/\\/$/u, "")}'}\/uf\/${'${request.fileKey}'}\`;
  const scope = request.worktreeId === void 0 ? "" : \`\/worktrees\/${'${encodeURIComponent(request.worktreeId)}'}\`;
  const dataUriByAssetId = new Map();
  await Promise.all([...new Set(references.map((reference) => reference.assetId))].map(async (assetId) => {
    const url = \`${'${root}'}${'${scope}'}\/universer-api\/file\/${'${encodeURIComponent(assetId)}'}\/content\`;
    const response = await fetch(url);
    if (!response.ok) {
      throw codedError("UNIT_CONTENT_ASSET_RESOLUTION_FAILED", \`Unable to resolve embedded image asset ${'${assetId}'} (HTTP ${'${response.status}'})\`);
    }
    const mediaType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    if (!/^image\\\/(?:png|jpeg|gif|webp)$/u.test(mediaType)) {
      throw codedError("UNIT_CONTENT_ASSET_RESOLUTION_FAILED", \`Embedded asset ${'${assetId}'} has unsupported media type ${'${mediaType || "unknown"}'}\`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) {
      throw codedError("UNIT_CONTENT_ASSET_RESOLUTION_FAILED", \`Embedded image asset ${'${assetId}'} is empty\`);
    }
    dataUriByAssetId.set(assetId, \`data:${'${mediaType}'};base64,${'${bytes.toString("base64")}'}\`);
  }));
  for (const reference of references) {
    const dataUri = dataUriByAssetId.get(reference.assetId);
    if (dataUri === void 0) continue;
    reference.record[reference.sourceKey] = dataUri;
    reference.record[reference.typeKey] = "BASE64";
  }
}
`;
let workerSource = await readFile(workerPath, "utf8");
if (workerSource.includes(workerExportSource)) {
  workerSource = workerSource.replace(workerExportSource, workerExportWithAssets);
} else if (!workerSource.includes(workerExportWithAssets)) {
  throw new Error(`Unable to enable Univer export asset inlining in ${workerPath}`);
}
if (!workerSource.includes("async function inlineGatewayAssetImages(value, request)")) {
  if (!workerSource.includes(workerExportAnchor)) {
    throw new Error(`Unable to locate the Univer export worker anchor in ${workerPath}`);
  }
  workerSource = workerSource.replace(workerExportAnchor, `${workerAssetHelper}\n${workerExportAnchor}`);
}
await writeFile(workerPath, workerSource, "utf8");

}
