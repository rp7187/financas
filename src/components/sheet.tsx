import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

// Trava a rolagem da página de fundo enquanto houver folha aberta (no iPhone, overflow: hidden não basta).
let openSheets = 0;
let savedY = 0;
function lockPage() {
  if (openSheets++ > 0) return;
  savedY = window.scrollY;
  const b = document.body.style;
  b.position = "fixed"; b.top = `-${savedY}px`; b.left = "0"; b.right = "0"; b.width = "100%";
}
function unlockPage() {
  if (--openSheets > 0) return;
  const b = document.body.style;
  b.position = ""; b.top = ""; b.left = ""; b.right = ""; b.width = "";
  window.scrollTo(0, savedY);
}

/**
 * Folha que sobe de baixo (formulários e detalhes). Rola por dentro (a página de fundo fica parada);
 * fecha tocando fora, no puxador, arrastando o puxador/título para baixo ou com Esc.
 */
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
  useEffect(() => { lockPage(); return unlockPage; }, []);

  // arrastar para baixo pelo puxador/título fecha
  const drag = useRef<{ y: number; active: boolean }>({ y: 0, active: false });
  const [dy, setDy] = useState(0);
  const start = (e: TouchEvent) => { drag.current = { y: e.touches[0].clientY, active: true }; };
  const move = (e: TouchEvent) => { if (drag.current.active) setDy(Math.max(0, e.touches[0].clientY - drag.current.y)); };
  const end = () => { if (!drag.current.active) return; drag.current.active = false; if (dy > 70) onClose(); else setDy(0); };

  return (
    <div class="sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class={`sheet-wrap ${dy ? "dragging" : ""}`} role="dialog" aria-modal="true" aria-labelledby="sheet-title" style={dy ? { transform: `translateY(${dy}px)` } : undefined}>
        <form class="sheet" onSubmit={onSubmit} noValidate>
          <div class="sheet-top" onTouchStart={start} onTouchMove={move} onTouchEnd={end} onTouchCancel={end}>
            <button type="button" class="sheet-handle" aria-label="Fechar" onClick={onClose} />
            <h2 id="sheet-title">{title}</h2>
          </div>
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

const PALETTE_KEYS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];
/** Escolha de cor da paleta validada (categorias/imóveis). */
export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div class="field">
      <span class="label">Cor nos gráficos</span>
      <div class="colors">
        {PALETTE_KEYS.map((c, i) => (
          <button key={c} type="button" class={`color swatch ${c} ${value === c ? "on" : ""}`} aria-label={`Cor ${i + 1}`} aria-pressed={value === c} onClick={() => onChange(c)} />
        ))}
      </div>
    </div>
  );
}
