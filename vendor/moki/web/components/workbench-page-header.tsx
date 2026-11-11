import type { ReactNode } from "react";

type WorkbenchPageHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  headingClassName?: string;
  actionsClassName?: string;
};

export function WorkbenchPageHeader({
  eyebrow,
  title,
  description,
  actions,
  className = "",
  headingClassName = "",
  actionsClassName = "",
}: WorkbenchPageHeaderProps) {
  return (
    <header
      className={`workbench-page-header mb-3 flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 ${className}`}
    >
      <div className={`min-w-0 ${headingClassName}`}>
        {eyebrow ? (
          <p className="moki-ui-eyebrow">
            {eyebrow}
          </p>
        ) : null}
        <h1 className={`${eyebrow ? "mt-1" : ""} moki-ui-page-title`}>
          {title}
        </h1>
        {description ? (
          <p className="moki-ui-muted mt-1">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className={`workbench-page-header-actions flex min-w-0 items-center ${actionsClassName}`}>
          {actions}
        </div>
      ) : null}
    </header>
  );
}
