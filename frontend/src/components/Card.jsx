export default function Card({ title, subtitle, actions, hover = false, className = "", children }) {
  return (
    <section className={`surface-card animate-fade-in ${hover ? "surface-card-hover" : ""} ${className}`}>
      {(title || subtitle || actions) && (
        <div className="mb-2.5 flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {title && <h3 className="text-sm font-semibold text-text">{title}</h3>}
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}
