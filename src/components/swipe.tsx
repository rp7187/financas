import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

/*
 * Linha deslizável (estilo Mail do iPhone):
 *  - para a direita: ação rápida (ex.: marcar como pago) — dispara ao soltar depois do limite;
 *  - para a esquerda: abre o botão Excluir; deslizar longo exclui direto.
 * A rolagem vertical continua nativa (touch-action: pan-y); o gesto só vale se for claramente horizontal.
 */

export type SwipeAction = { label: string; tone: "pay" | "unpay" | "del"; run: () => void };

const TRIGGER = 72; // px para disparar a ação da direita / abrir o Excluir
const OPEN = 88; // largura do botão Excluir aberto
const FULL = 0.55; // fração da largura para excluir direto

export function SwipeRow({ id, openId, setOpenId, left, right, children, tag = "li", class: cls = "" }: {
  id: string;
  /** elemento externo: "li" (listas) ou "div" (ex.: cartões da aba Contas) */
  tag?: "li" | "div";
  class?: string;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  /** ação ao deslizar para a DIREITA (aparece à esquerda) */
  left?: SwipeAction;
  /** ação ao deslizar para a ESQUERDA (aparece à direita) */
  right?: SwipeAction;
  children: ComponentChildren;
}) {
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const g = useRef({ x: 0, y: 0, base: 0, lock: null as null | "h" | "v", moved: false, width: 1, pid: -1 });
  const isOpen = openId === id;

  useEffect(() => { if (!isOpen && !drag) setDx(0); }, [isOpen]);

  const Tag = tag;
  if (!left && !right) return <Tag class={`swipe ${cls}`}>{children}</Tag>;

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    g.current = { x: e.clientX, y: e.clientY, base: isOpen ? -OPEN : 0, lock: null, moved: false, width: el.offsetWidth || 1, pid: e.pointerId };
    if (openId && !isOpen) setOpenId(null);
  };
  const onMove = (e: PointerEvent) => {
    const s = g.current;
    if (s.pid !== e.pointerId) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.lock) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      s.lock = Math.abs(mx) > Math.abs(my) * 1.2 ? "h" : "v";
      if (s.lock === "h") { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(true); }
    }
    if (s.lock !== "h") return;
    s.moved = true;
    let x = s.base + mx;
    if (x > 0 && !left) x = 0;
    if (x < 0 && !right) x = 0;
    // resistência depois do limite da ação da direita
    if (x > TRIGGER * 1.6) x = TRIGGER * 1.6 + (x - TRIGGER * 1.6) * 0.25;
    setDx(x);
  };
  const onUp = (e: PointerEvent) => {
    const s = g.current;
    if (s.pid !== e.pointerId) return;
    s.pid = -1;
    if (s.lock !== "h") return;
    setDrag(false);
    if (dx > TRIGGER && left) { setDx(0); setOpenId(null); left.run(); }
    else if (dx < -s.width * FULL && right) { setDx(-s.width); setOpenId(null); setTimeout(() => right.run(), 160); }
    else if (dx < -TRIGGER / 2 && right) { setDx(-OPEN); setOpenId(id); }
    else { setDx(0); if (isOpen) setOpenId(null); }
  };
  // depois de um deslize (ou com o Excluir aberto), o toque não abre o lançamento
  const onClickCapture = (e: Event) => {
    if (g.current.moved || isOpen) {
      e.preventDefault(); e.stopPropagation();
      g.current.moved = false;
      if (isOpen) setOpenId(null);
    }
  };

  const showLeft = dx > 0 && left;
  const showRight = dx < 0 && right;
  return (
    <Tag class={`swipe ${cls}`}>
      {showLeft && (
        <div class={`swipe-bg ${left!.tone} ${dx > TRIGGER ? "armed" : ""}`} aria-hidden="true"><span>{left!.label}</span></div>
      )}
      {showRight && (
        <div class={`swipe-bg del ${dx < -g.current.width * FULL ? "armed" : ""}`}>
          <button type="button" style={{ width: `${Math.max(OPEN, -dx)}px` }} onClick={() => { setDx(0); setOpenId(null); right!.run(); }}>{right!.label}</button>
        </div>
      )}
      <div class={`swipe-fg ${drag ? "" : "anim"}`} style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onClickCapture={onClickCapture}>
        {children}
      </div>
    </Tag>
  );
}

/** Aviso temporário com "Desfazer" (acima da barra de abas). */
export function UndoToast({ toast, onDone }: { toast: { text: string; undo?: () => void; key: number } | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, 5000);
    return () => clearTimeout(t);
  }, [toast?.key]);
  if (!toast) return null;
  return (
    <div class="toast" role="status">
      <span>{toast.text}</span>
      {toast.undo && <button type="button" onClick={() => { toast.undo!(); onDone(); }}>Desfazer</button>}
    </div>
  );
}
