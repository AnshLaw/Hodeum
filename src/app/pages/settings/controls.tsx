import type { ReactNode } from "react";

export function Row({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return (
    <div className="hsetting">
      <span className="hsetting__text">
        <strong>{label}</strong>
        {detail && <span className="hmuted">{detail}</span>}
      </span>
      {children}
    </div>
  );
}

/** A compact one-of-many switch, e.g. Top / Left / Right. */
export function Segmented<T extends string>({ label, options, value, onSelect, disabled }: { label: string; options: [T, string][]; value: T; onSelect: (value: T) => void; disabled?: boolean }) {
  return (
    <div className="hsegment" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
      {options.map(([key, text]) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} disabled={disabled} onClick={() => onSelect(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** Colour dots; the name is the accessible label. */
export function Swatches<T extends string>({ label, colors, names, value, onSelect }: { label: string; colors: Record<T, string>; names: Record<T, string>; value: T; onSelect: (value: T) => void }) {
  return (
    <div className="hswatches" role="radiogroup" aria-label={label}>
      {(Object.keys(colors) as T[]).map((key) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} aria-label={names[key]} title={names[key]} className="hswatch" style={{ background: colors[key] }} onClick={() => onSelect(key)} />
      ))}
    </div>
  );
}
