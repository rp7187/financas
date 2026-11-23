import type { Store } from "../app";
import type { Account, Rec } from "../model";
import type { SwipeAction } from "./swipe";

export type Toast = { text: string; undo?: () => void; key: number };

/** Conta em uso: lançamentos, recorrentes, parcelamentos ou referência de cartão/investimento. */
export function accountInUse(store: Store, a: Account): boolean {
  const d = store.data;
  return d.txns.some((t) => t.accountId === a.id || t.toAccountId === a.id)
    || d.rules.some((r) => r.accountId === a.id)
    || d.plans.some((p) => p.accountId === a.id)
    || d.accounts.some((x) => x.id !== a.id && !x.archived && (x.payFromId === a.id || x.bankId === a.id));
}

/**
 * Deslizar numa conta/cartão/investimento:
 *  - para a esquerda: Excluir (sem uso) ou Arquivar (com lançamentos — o histórico continua);
 *  - para a direita (só arquivados): Reativar.
 * Sempre com "Desfazer".
 */
export function accountSwipe(store: Store, a: Account, toast: (t: Toast) => void): { left?: SwipeAction; right?: SwipeAction } {
  const noun = a.kind === "credit" ? "Cartão" : a.kind === "investment" || a.kind === "savings" ? "Investimento" : "Conta";
  const used = accountInUse(store, a);
  const o = noun === "Conta" ? "a" : "o"; // concordância: "Conta … excluída", "Cartão … excluído"
  const right: SwipeAction | undefined = used
    ? (a.archived ? undefined : {
      label: "Arquivar", tone: "del", run: async () => {
        await store.put([{ ...a, archived: true }]);
        toast({ text: `${noun} "${a.name}" arquivad${o} (tem lançamentos; o histórico continua)`, key: Date.now(), undo: () => store.put([{ ...a, archived: a.archived }]) });
      },
    })
    : {
      label: "Excluir", tone: "del", run: async () => {
        const vals = store.data.valuations.filter((v) => v.accountId === a.id); // saldos informados vão junto
        const recs: Rec[] = [a, ...vals];
        await store.del(recs);
        toast({ text: `${noun} "${a.name}" excluíd${o}`, key: Date.now(), undo: () => store.put(recs) });
      },
    };
  const left: SwipeAction | undefined = a.archived
    ? { label: "Reativar", tone: "pay", run: async () => { await store.put([{ ...a, archived: false }]); toast({ text: `${noun} "${a.name}" reativad${o}`, key: Date.now() }); } }
    : undefined;
  return { left, right };
}
