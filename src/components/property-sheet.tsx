import { useState } from "preact/hooks";
import type { Store } from "../app";
import { PROPERTY_KIND, uid, type Property, type PropertyKind } from "../model";
import { Sheet } from "./sheet";

export function PropertySheet({ store, property, onClose }: { store: Store; property: Property | null; onClose: () => void }) {
  const [name, setName] = useState(property?.name ?? "");
  const [kind, setKind] = useState<PropertyKind>(property?.kind ?? "apartment");
  const [note, setNote] = useState(property?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const used = property
    ? store.data.txns.some((t) => t.propertyId === property.id) || store.data.rules.some((r) => r.propertyId === property.id) || store.data.plans.some((p) => p.propertyId === property.id)
    : false;

  async function submit(e: Event) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError("Informe um nome (ex.: Apto Centro, Casa da praia).");
    if (store.data.properties.some((p) => p.id !== property?.id && p.name.toLowerCase() === n.toLowerCase())) return setError("Já existe um imóvel com esse nome.");
    await store.put([{ ...(property ?? { id: uid(), t: "property", updatedAt: 0 }), name: n, kind, note: note.trim() || undefined } as Property]);
    onClose();
  }

  return (
    <Sheet title={property ? "Editar imóvel" : "Novo imóvel"} onClose={onClose} onSubmit={submit}
      actions={<>
        {property && (used
          ? <button type="button" class="btn ghost" onClick={async () => { await store.put([{ ...property, archived: !property.archived }]); onClose(); }}>{property.archived ? "Reativar" : "Arquivar"}</button>
          : <button type="button" class="btn ghost danger" onClick={async () => { if (confirm(`Excluir "${property.name}"?`)) { await store.del([property]); onClose(); } }}>Excluir</button>)}
        <button type="button" class="btn ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" class="btn primary">Salvar</button>
      </>}>
      <label>Nome<input type="text" value={name} placeholder="ex.: Apto Centro" onInput={(e) => { setName(e.currentTarget.value); setError(null); }} /></label>
      <div class="field">
        <span class="label">Tipo</span>
        <div class="chips">
          {(Object.keys(PROPERTY_KIND) as PropertyKind[]).map((k) => (
            <button key={k} type="button" class={`chip ${kind === k ? "on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {PROPERTY_KIND[k].emoji} {PROPERTY_KIND[k].label}
            </button>
          ))}
        </div>
      </div>
      <label>Observação (opcional)<input type="text" value={note} placeholder="endereço, matrícula, inquilino…" onInput={(e) => setNote(e.currentTarget.value)} /></label>
      {property && used && <p class="muted small">Imóveis com lançamentos não são excluídos, só arquivados (o histórico continua).</p>}
      {error && <p class="error" role="alert">{error}</p>}
    </Sheet>
  );
}
