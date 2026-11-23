import type { Store } from "../app";
import { dayMonth, monthLong } from "../dates";
import type { Item } from "../engine";
import { colorOf, money } from "../model";
import { Sheet } from "./sheet";

/**
 * Detalhe de uma categoria nas Análises: os lançamentos que formam o total (mesmo período e conta da tela).
 * Inclui recorrentes previstos (entram no total). Tocar num lançamento abre a edição.
 */
export function CategoryDetail({ store, categoryId, items, period, onClose }: {
  store: Store; categoryId: string; items: Item[]; period: string; onClose: () => void;
}) {
  const { data } = store;
  const cat = data.categories.find((c) => c.id === categoryId);
  const list = [...items].sort((a, b) => b.txn.date.localeCompare(a.txn.date) || b.txn.amount - a.txn.amount);
  const total = list.reduce((s, it) => s + it.txn.amount, 0);
  const months = new Map<string, Item[]>();
  for (const it of list) { const m = it.txn.date.slice(0, 7); months.set(m, [...(months.get(m) ?? []), it]); }
  const multi = months.size > 1;
  const sign = cat?.type === "income" ? "+" : "−";

  return (
    <Sheet title={<span class="cat-title"><span class={`avatar ${colorOf({ id: categoryId, color: cat?.color })}`} aria-hidden="true">{cat?.emoji ?? "•"}</span>{cat?.name ?? "Sem categoria"}</span>}
      onClose={onClose} onSubmit={(e) => { e.preventDefault(); onClose(); }}
      actions={<button type="submit" class="btn primary">Fechar</button>}>
      <div class="cat-sum">
        <span>{period} · {list.length} lançamento{list.length === 1 ? "" : "s"}</span>
        <b class="num">{money(total)}</b>
      </div>
      {[...months.entries()].map(([m, its]) => (
        <section key={m}>
          {multi && (
            <div class="day-head bank-head"><span>{monthLong(m)}</span><span class="num">{money(its.reduce((s, it) => s + it.txn.amount, 0))}</span></div>
          )}
          <ul class="group cat-list">
            {its.map((it) => {
              const t = it.txn;
              const acc = data.accounts.find((a) => a.id === t.accountId);
              const extra = it.plan ? ` · ${t.installment}/${it.plan.count}` : it.rule ? " · mensal" : "";
              return (
                <li key={t.id}>
                  <button type="button" class="row-main cat-row" onClick={() => { onClose(); store.openTxn(it); }}>
                    <span class="cat-date num">{dayMonth(t.date)}</span>
                    <span class="what">
                      <span class="desc">{t.description}</span>
                      <span class="sub">{acc?.name ?? "?"}{extra}</span>
                    </span>
                    <span class="right">
                      <span class={`amount num ${t.type}`}>{sign}{money(t.amount)}</span>
                      {it.virtual ? <span class="pill">previsto</span> : !t.paid && !data.cards.has(t.accountId) ? <span class="pill">pendente</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {!list.length && <p class="muted small">Nenhum lançamento no período.</p>}
    </Sheet>
  );
}
