import { CircleAlert, RefreshCw, Unplug } from 'lucide-react';
import { Button } from './ui-controls.js';
import './request-error-notice.css';

export type RequestErrorNoticeProps = {
  error: string;
  busy?: boolean;
  onRetry?: (() => void) | undefined;
  className?: string;
  fallbackTitle?: string;
  description?: string;
};

export function RequestErrorNotice({ error, busy = false, onRetry, className = '', fallbackTitle = '请求暂未完成', description }: RequestErrorNoticeProps) {
  const connection = /工作台.*(?:会话|连接)|会话.*(?:失效|过期)|session.*(?:expired|invalid)|failed to fetch|network\s?error|网络|连接.*(?:失败|中断|超时)|ECONN|timeout/i.test(error);
  const unreadable = /JSON|响应.*(?:为空|无效|不完整)|unexpected (?:end|token)/i.test(error);
  return <section className={`moki-ui-card moki-request-error-notice ${className}`} role="alert" aria-busy={busy}>
    <span className="moki-request-error-icon" aria-hidden="true">{connection ? <Unplug size={20}/> : <CircleAlert size={20}/>}</span>
    <div className="moki-request-error-copy">
      <h3>{connection ? '暂时无法连接工作台' : unreadable ? '暂时无法读取数据' : fallbackTitle}</h3>
      <p>{description ?? (onRetry ? '请重新加载，恢复后可继续操作。' : '请稍后再试，或展开详情查看原因。')}</p>
      <details><summary>查看错误详情</summary><p>{error}</p></details>
    </div>
    {onRetry ? <Button size="compact" loading={busy} loadingLabel={connection ? '正在连接' : '正在加载'} onClick={onRetry}>
      <RefreshCw size={14} aria-hidden="true"/>{connection ? '重新连接' : '重新加载'}
    </Button> : null}
  </section>;
}
