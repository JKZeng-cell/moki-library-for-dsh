import type { ComponentPropsWithRef, HTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

type ControlSize = "regular" | "compact" | "toolbar";
type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: ControlSize;
  loading?: boolean;
  loadingLabel?: string;
};

export function Button({ variant = "secondary", size = "regular", loading = false, loadingLabel,
  type = "button", disabled, className = "", children, ...props }: ButtonProps) {
  return <button {...props} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
    data-variant={variant} data-size={size} className={`moki-ui-button ${className}`}>
    <span className="moki-ui-button-content" style={loading ? { visibility: "hidden" } : undefined} aria-hidden={loading || undefined}>{children}</span>
    {loading ? <span className="moki-ui-button-progress"><LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" /><span className={loadingLabel ? "" : "sr-only"}>{loadingLabel ?? "处理中"}</span></span> : null}
  </button>;
}

export function IconButton({ className = "", size = "compact", ...props }: ButtonProps & { "aria-label": string }) {
  return <Button {...props} size={size} title={props.title ?? props["aria-label"]} className={`moki-ui-icon-button ${className}`} />;
}

export function Input({ controlSize = "regular", className = "", ...props }: ComponentPropsWithRef<"input"> & { controlSize?: Exclude<ControlSize, "toolbar"> }) {
  return <input {...props} data-size={controlSize} className={`moki-ui-input ${className}`} />;
}

export function Select({ controlSize = "regular", className = "", ...props }: ComponentPropsWithRef<"select"> & { controlSize?: Exclude<ControlSize, "toolbar"> }) {
  return <select {...props} data-size={controlSize} className={`moki-ui-select ${className}`} />;
}

export type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
export function StatusBadge({ tone = "neutral", className = "", children, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone; children: ReactNode }) {
  return <span {...props} data-tone={tone} className={`moki-ui-badge moki-ui-tone ${className}`}>{children}</span>;
}
