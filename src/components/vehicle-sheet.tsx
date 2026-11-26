import { useState } from "preact/hooks";
import type { Store } from "../app";
import { PALETTE, VEHICLE_KIND, colorOf, uid, type Vehicle, type VehicleKind } from "../model";
import { ColorPicker, Sheet } from "./sheet";

export function VehicleSheet({ store, vehicle, onClose }: { store: Store; vehicle: Vehicle | null; onClose: () => void }) {
  const [name, setName] = useState(vehicle?.name ?? "");
  const [kind, setKind] = useState<VehicleKind>(vehicle?.kind ?? "car");
  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  const [note, setNote] = useState(vehicle?.note ?? "");
  const [color, setColor] = useState(vehicle ? colorOf(vehicle) : PALETTE[store.data.vehicles.length % PALETTE.length]);
  const [error, setError] = useState<string | null>(null);
  const used = vehicle
    ? store.data.txns.some((t) => t.vehicleId === vehicle.id) || store.data.rules.some((r) => r.vehicleId === vehicle.id) || store.data.plans.some((p) => p.vehicleId === vehicle.id)
    : false;

  async function submit(e: Event) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError("Informe um nome (ex.: Compass, Moto do Rafael).");
    if (store.data.vehicles.some((v) => v.id !== vehicle?.id && v.name.toLowerCase() === n.toLowerCase())) return setError("Já existe um veículo com esse nome.");
    await store.put([{ ...(vehicle ?? { id: uid(), t: "vehicle", updatedAt: 0 }), name: n, kind, plate: plate.trim().toUpperCase() || undefined, note: note.trim() || undefined, color } as Vehicle]);
    onClose();
  }

  return (
    <Sheet title={vehicle ? "Editar veículo" : "Novo veículo"} onClose={onClose} onSubmit={submit}
      actions={<>
        {vehicle && (used
          ? <button type="button" class="btn ghost" onClick={async () => { await store.put([{ ...vehicle, archived: !vehicle.archived }]); onClose(); }}>{vehicle.archived ? "Reativar" : "Arquivar"}</button>
          : <button type="button" class="btn ghost danger" onClick={async () => { if (confirm(`Excluir "${vehicle.name}"?`)) { await store.del([vehicle]); onClose(); } }}>Excluir</button>)}
        <button type="button" class="btn ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" class="btn primary">Salvar</button>
      </>}>
      <label>Nome<input type="text" value={name} placeholder="ex.: Compass, Moto" onInput={(e) => { setName(e.currentTarget.value); setError(null); }} /></label>
      <div class="field">
        <span class="label">Tipo</span>
        <div class="chips">
          {(Object.keys(VEHICLE_KIND) as VehicleKind[]).map((k) => (
            <button key={k} type="button" class={`chip ${kind === k ? "on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {VEHICLE_KIND[k].emoji} {VEHICLE_KIND[k].label}
            </button>
          ))}
        </div>
      </div>
      <label>Placa (opcional)<input type="text" value={plate} placeholder="ex.: ABC1D23" autoCapitalize="characters" onInput={(e) => setPlate(e.currentTarget.value)} /></label>
      <label>Observação (opcional)<input type="text" value={note} placeholder="modelo, ano, seguro…" onInput={(e) => setNote(e.currentTarget.value)} /></label>
      <ColorPicker value={color} onChange={setColor} />
      {vehicle && used && <p class="muted small">Veículos com lançamentos não são excluídos, só arquivados (o histórico continua).</p>}
      {error && <p class="error" role="alert">{error}</p>}
    </Sheet>
  );
}
