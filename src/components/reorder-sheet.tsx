import { useState } from "preact/hooks";
import type { Store } from "../app";
import { isCard, isInvestAccount, type Account } from "../model";
import { Icon, AccountBadge } from "./icons";
import { Sheet } from "./sheet";

/*
 * Ordenar contas, cartões e investimentos (setas ↑ ↓). Usa o campo `order` que as contas sempre tiveram:
 * a ordem vale em todo o app (aba Contas, filtros, escolha de conta). Arquivados vão para o fim.
 */
export function ReorderSheet({ store, onClose }: { store: Store; onClose: () => void }) {
  const active = store.data.accounts.filter((a) => !a.archived);
  const [lists, setLists] = useState<Account[][]>(() => [
    active.filter((a) => !isCard(a) && !isInvestAccount(a)),
    active.filter(isCard),
    active.filter(isInvestAccount),
  ]);
  const titles = ["Contas", "Cartões de crédito", "Investimentos"];

  const move = (li: number, i: number, dir: -1 | 1) => {
    const j = i + dir;
    const list = [...lists[li]];
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setLists(lists.map((l, k) => (k === li ? list : l)));
  };

  async function submit(e: Event) {
    e.preventDefault();
    // ordem nova: contas, cartões, investimentos e, no fim, os arquivados (na ordem em que estavam)
    const seq = [...lists.flat(), ...store.data.accounts.filter((a) => a.archived)];
    const changed = seq.map((a, i) => (a.order === i ? null : { ...a, order: i })).filter((a): a is Account => !!a);
    if (changed.length) await store.put(changed);
    onClose();
  }

  return (
    <Sheet title="Ordenar" onClose={onClose} onSubmit={submit}
      actions={<><button type="button" class="btn ghost" onClick={onClose}>Cancelar</button><button type="submit" class="btn primary">Salvar</button></>}>
      <p class="muted small hint">Use as setas para escolher quem aparece primeiro. A ordem vale em todo o app.</p>
      {lists.map((list, li) => list.length > 0 && (
        <div key={li} class="field">
          <span class="label">{titles[li]}</span>
          <ul class="reorder">
            {list.map((a, i) => (
              <li key={a.id}>
                <AccountBadge a={a} />
                <span class="grow">{a.name}</span>
                <button type="button" class="icon-btn sm" aria-label={`Subir ${a.name}`} disabled={i === 0} onClick={() => move(li, i, -1)}><Icon name="up" /></button>
                <button type="button" class="icon-btn sm" aria-label={`Descer ${a.name}`} disabled={i === list.length - 1} onClick={() => move(li, i, 1)}><Icon name="down" /></button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Sheet>
  );
}
