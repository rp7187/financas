import { useEffect } from "preact/hooks";
import type { ComponentChildren } from "preact";

/** Folha que sobe de baixo (formulários). */
export function Sheet({ title, onClose, onSubmit, actions, children }: {
  title: ComponentChildren;
  onClose: () => void;
  onSubmit: (e: Event) => void;
  actions: ComponentChildren;
  children: ComponentChildren;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div class="sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="sheet-wrap" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <form class="sheet" onSubmit={onSubmit} noValidate>
          <h2 id="sheet-title">{title}</h2>
          {children}
          <div class="actions">{actions}</div>
        </form>
      </div>
    </div>
  );
}

/** Valor em reais digitado como numa maquininha: os dígitos entram pela direita (centavos). */
export function MoneyInput({ value, onChange, label, autoFocus }: { value: number; onChange: (cents: number) => void; label: string; autoFocus?: boolean }) {
  const shown = (value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <label class="money-input">
      {label}
      <div class="money-field">
        <span>R$</span>
        <input type="text" inputMode="numeric" autoComplete="off" value={shown} autoFocus={autoFocus}
          onInput={(e) => {
            const digits = e.currentTarget.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 11);
            const cents = Number(digits || "0");
            onChange(cents);
            e.currentTarget.value = (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          }} />
      </div>
    </label>
  );
}
