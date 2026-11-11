import { LoaderCircle } from "lucide-react";
import './page-feedback.css';

/** A shared, bounded loading state; never replaces the native window surface. */
export function PageFeedback({ title, description, layout = 'page', skeleton = 'none' }: {
  title: string; description?: string; layout?: 'page' | 'section' | 'inline'; skeleton?: 'none' | 'rows' | 'cards';
}) {
  return <div className="moki-page-feedback" data-layout={layout} role="status" aria-label={title} aria-live="polite" aria-atomic="true">
    <div className="moki-loading-copy">
      <span className="moki-loading-symbol" aria-hidden="true"><LoaderCircle size={20} /></span>
      <div className="moki-loading-text"><p className="moki-loading-title">{title}</p>{description && <p className="moki-loading-description">{description}</p>}</div>
    </div>
    {skeleton !== 'none' && layout !== 'inline' && <div className="moki-loading-skeleton" data-shape={skeleton} aria-hidden="true">{[0, 1, 2].map(index => <div className="moki-loading-placeholder" key={index}><i /><span /><span /></div>)}</div>}
  </div>;
}
