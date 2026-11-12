import { l as uiText } from '../../../../src/i18n.js';
import { ArrowUp, FolderOpen } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./library-path-bar.css";

export function LibraryPathBar({ path, children, onNavigate, onUp }: {
  path: string;
  children: ReactNode;
  onNavigate: (path: string) => void;
  onUp?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(path);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const crumbs = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (crumbs.current) crumbs.current.scrollLeft = crumbs.current.scrollWidth;
  }, [path, editing]);
  function begin() {
    setDraft(path);
    setError("");
    setEditing(true);
    input.current?.select();
  }
  function finish() {
    setEditing(false);
    setError("");
  }
  return <div className="library-path-container">
    <section className="library-path-bar" aria-label={uiText("资料库路径")}>
      <div className="library-path-field" data-editing={editing || undefined}>
        {onUp && <button type="button" className="library-path-up" onClick={onUp} aria-label={uiText("返回上一级")} title={uiText("返回上一级")}><ArrowUp size={15}/></button>}
        <FolderOpen size={15} className="library-path-icon" aria-hidden="true"/>
        <div className="library-path-track">
          <input ref={input} type="text" aria-label={uiText("输入资料库路径")} autoComplete="off" spellCheck={false}
            value={editing ? draft : path} title={path} onFocus={begin} onBlur={finish}
            aria-invalid={Boolean(error)} aria-describedby={error ? "library-path-error" : undefined}
            onChange={event => {setDraft(event.target.value); setError("");}}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault(); event.stopPropagation(); event.currentTarget.blur();
              } else if (event.key === "Enter") {
                event.preventDefault(); event.stopPropagation();
                try { onNavigate(draft); event.currentTarget.blur(); }
                catch (reason) { setError(reason instanceof Error ? reason.message : uiText("无法打开该路径")); }
              }
            }}/>
          {!editing && <nav ref={crumbs} className="library-path-crumbs" aria-label={uiText("资料库文件夹层级")} title={path}
            onPaste={event => {
              const text = event.clipboardData.getData("text/plain");
              if (!text.trim()) return;
              event.preventDefault(); input.current?.focus(); setDraft(text);
            }}
            onClickCapture={event => {
              if ((event.target as Element).closest('[aria-current="location"]')) {
                event.stopPropagation(); input.current?.focus();
              }
            }}>{children}</nav>}
        </div>
      </div>
    </section>
    {error && <p id="library-path-error" role="alert" className="library-path-error">{error}</p>}
  </div>;
}
