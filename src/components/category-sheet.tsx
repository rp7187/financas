import { useState } from "preact/hooks";
import type { Store } from "../app";
import { PALETTE, colorOf, uid, type Category, type Flow } from "../model";
import { ColorPicker, Sheet } from "./sheet";

const EMOJIS = ["🏠", "💡", "🚿", "📶", "🛒", "🍽️", "🚗", "⛽", "🩺", "💊", "📚", "🍼", "🎉", "📺", "👕", "🧾", "🛡️", "🎁", "🐶", "✈️", "💼", "🏖️", "✨", "📈", "↩️", "💰", "🏋️", "💇", "🔧", "📦"];

export function CategorySheet({ store, target, onClose }: { store: Store; target: Category | { type: Flow }; onClose: () => void }) {
  const cat = "id" in target ? target : null;
  const [name, setName] = useState(cat?.name ?? "");
  const [type, setType] = useState<Flow>(target.type);
  const [emoji, setEmoji] = useState(cat?.emoji ?? "📦");
  // nova categoria: próxima cor da paleta (pela quantidade existente) — fica gravada e não muda com o ranking
  const [color, setColor] = useState(cat ? colorOf(cat) : PALETTE[store.data.categories.length % PALETTE.length]);
  const [error, setError] = useState<string | null>(null);
  const used = cat ? store.data.txns.some((t) => t.categoryId === cat.id) || store.data.rules.some((r) => r.categoryId === cat.id) : false;

  async function submit(e: Event) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError("Informe o nome.");
    if (store.data.categories.some((c) => c.id !== cat?.id && c.type === type && c.name.toLowerCase() === n.toLowerCase())) return setError("Já existe uma categoria com esse nome.");
    await store.put([{ ...(cat ?? { id: uid(), t: "category", updatedAt: 0 }), name: n, type, emoji, color } as Category]);
    onClose();
  }

  return (
    <Sheet title={cat ? "Editar categoria" : "Nova categoria"} onClose={onClose} onSubmit={submit}
      actions={<>
        {cat && (used
          ? <button type="button" class="btn ghost" onClick={async () => { await store.put([{ ...cat, archived: !cat.archived }]); onClose(); }}>{cat.archived ? "Reativar" : "Arquivar"}</button>
          : <button type="button" class="btn ghost danger" onClick={async () => { if (confirm(`Excluir "${cat.name}"?`)) { await store.del([cat]); onClose(); } }}>Excluir</button>)}
        <button type="button" class="btn ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" class="btn primary">Salvar</button>
      </>}>
      {!cat && (
        <div class="seg wide" role="group" aria-label="Tipo">
          <button type="button" class={type === "expense" ? "on expense" : ""} onClick={() => setType("expense")}>Despesa</button>
          <button type="button" class={type === "income" ? "on income" : ""} onClick={() => setType("income")}>Receita</button>
        </div>
      )}
      <label>Nome<input type="text" value={name} onInput={(e) => { setName(e.currentTarget.value); setError(null); }} /></label>
      <div class="field">
        <span class="label">Ícone</span>
        <div class="emojis">
          {EMOJIS.map((e) => <button key={e} type="button" class={`emoji-btn ${emoji === e ? "on" : ""}`} aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</button>)}
        </div>
      </div>
      <ColorPicker value={color} onChange={setColor} />
      {cat && used && <p class="muted small">Categorias em uso não são excluídas, só arquivadas (somem da lista de escolha; o histórico continua).</p>}
      {error && <p class="error" role="alert">{error}</p>}
    </Sheet>
  );
}
