import { useState } from "preact/hooks";
import type { Store } from "../app";
import { addMonths, daysInMonth, monthLong, monthShort, thisMonth, todayISO } from "../dates";
import { currentBalance, investBalanceAt, investFlows, investMonth, investTotalMonth, type InvestMonth } from "../engine";
import { ASSET_CLASS, assetClassOf, money, moneyCompact, moneyShort, reais, signedMoney, type Account, type AssetClass, type Valuation } from "../model";
import { Icon } from "./icons";
import { PageHead } from "./page-head";
import { SwipeRow, UndoToast } from "./swipe";
import { accountSwipe, type Toast } from "./account-actions";
import { MoneyInput, Sheet } from "./sheet";

/*
 * Aba Investimentos: saldo de cada aplicação (pelo valor informado no mês), rendimento do mês e do ano,
 * evolução e divisão da carteira. Aportes/resgates são transferências; rendimento = saldo − saldo anterior − aportes líquidos.
 */

const pctText = (p: number | null) => (p === null ? "—" : `${p >= 0 ? "+" : "−"}${Math.abs(p * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const lastDay = (m: string) => `${m}-${String(daysInMonth(m)).padStart(2, "0")}`;
const CLASS_ORDER = Object.keys(ASSET_CLASS) as AssetClass[];

export function Investments({ store }: { store: Store }) {
  const { data } = store;
  const [table, setTable] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const cur = thisMonth();
  const year = cur.slice(0, 4);
  const invs = data.accounts.filter((a) => data.investments.has(a.id));
  const active = invs.filter((a) => !a.archived);
  const ids = invs.map((a) => a.id);
  const bal = new Map(invs.map((a) => [a.id, currentBalance(data, a.id)]));
  const total = [...bal.values()].reduce((s, v) => s + v, 0);

  // meses com dados: do 1º saldo informado até o mês atual (máx. 12 no gráfico)
  const firstMonth = data.valuations.find((v) => ids.includes(v.accountId))?.month;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(cur, i - 11)).filter((m) => firstMonth && m >= firstMonth);
  const rows = months.map((m) => investTotalMonth(data, ids, m));
  const now = rows[rows.length - 1];
  const ytd = rows.filter((r) => r.month.startsWith(year));
  const ytdYield = ytd.reduce((s, r) => s + r.yield, 0);
  const ytdFlows = ytd.reduce((s, r) => s + r.flows, 0);
  // % do ano: composto mês a mês (rentabilidade por tempo, como os bancos mostram)
  const ytdPct = ytd.some((r) => r.updated && r.pct !== null) ? ytd.reduce((acc, r) => (r.updated && r.pct !== null ? acc * (1 + r.pct) : acc), 1) - 1 : null;
  const pending = active.filter((a) => !data.valuations.some((v) => v.accountId === a.id && v.month === cur));

  // por banco (conta vinculada)
  const groups = new Map<string, Account[]>();
  for (const a of active) { const k = a.bankId ?? ""; groups.set(k, [...(groups.get(k) ?? []), a]); }
  // divisão por tipo
  const byClass = new Map<AssetClass, number>();
  for (const a of active) { const k = assetClassOf(a); byClass.set(k, (byClass.get(k) ?? 0) + (bal.get(a.id) ?? 0)); }
  const classes = CLASS_ORDER.filter((k) => (byClass.get(k) ?? 0) > 0);

  return (
    <>
      <PageHead store={store} title="Investimentos">
        <button type="button" class="btn small ghost" onClick={() => store.openAccount({ kind: "investment" })}><Icon name="plus" />Investimento</button>
      </PageHead>

      {!invs.length ? (
        <section class="card empty-invest">
          <p><b>Acompanhe seus investimentos</b></p>
          <p class="muted small">Cadastre cada aplicação (CDB, Tesouro, ações, poupança…) com o saldo de hoje e o banco. Uma vez por mês,
            atualize os saldos: o app calcula quanto rendeu, descontando o que você aplicou ou resgatou.</p>
          <button type="button" class="btn brand" onClick={() => store.openAccount({ kind: "investment" })}><Icon name="plus" />Cadastrar investimento</button>
        </section>
      ) : (
        <>
          <section class="hero">
            <p class="hero-label" style={{ marginTop: 0 }}>Total investido</p>
            <div class="hero-amount num">{money(total)}</div>
            {now && (
              <div class="hero-sub">Rendimento em {monthLong(cur).split(" ")[0].toLowerCase()}{" "}
                <b class="num">{now.updated ? `${signedMoney(now.yield)} (${pctText(now.pct)})` : "aguardando saldos"}</b></div>
            )}
            {ytd.length > 0 && (
              <div class="hero-sub">No ano <b class="num">{signedMoney(ytdYield)} ({pctText(ytdPct)})</b> · aportes líquidos <b class="num">{signedMoney(ytdFlows)}</b></div>
            )}
          </section>

          {pending.length > 0 && (
            <button type="button" class="alert" onClick={store.openValuations}>
              <Icon name="info" />Atualize os saldos de {monthLong(cur).split(" ")[0].toLowerCase()} ({pending.length} de {active.length})<Icon name="chevR" class="tile-chev" />
            </button>
          )}
          {!pending.length && (
            <button type="button" class="btn ghost wide" onClick={store.openValuations}><Icon name="check" />Saldos de {monthLong(cur).split(" ")[0].toLowerCase()} atualizados · editar</button>
          )}

          {[...groups.entries()].map(([bankId, list]) => {
            const bank = data.accounts.find((a) => a.id === bankId);
            const sum = list.reduce((s, a) => s + (bal.get(a.id) ?? 0), 0);
            return (
              <section key={bankId}>
                <div class="day-head bank-head"><span>{bank?.name ?? "Sem banco vinculado"}</span><span class="num">{money(sum)}</span></div>
                <ul class="group">
                  {list.map((a) => {
                    const r = investMonth(data, a.id, cur);
                    const act = accountSwipe(store, a, setToast);
                    return (
                      <SwipeRow key={a.id} id={a.id} openId={openId} setOpenId={setOpenId} right={act.right}>
                        <button type="button" class="row-main inv-row" onClick={() => store.openAccount(a)}>
                          <span class="inv-dot" style={{ background: a.color }} />
                          <span class="what">
                            <span class="desc">{a.name}</span>
                            <span class="sub">{ASSET_CLASS[assetClassOf(a)]}</span>
                          </span>
                          <span class="right">
                            <span class="amount num">{money(bal.get(a.id) ?? 0)}</span>
                            {r?.updated
                              ? <span class={`pill ${r.yield >= 0 ? "gain" : "late"}`}>{signedMoney(r.yield)} · {pctText(r.pct)}</span>
                              : <span class="pill">{!r ? "sem histórico" : data.valuations.find((v) => v.accountId === a.id)?.month === cur ? "acompanhando desde este mês" : "saldo não atualizado"}</span>}
                          </span>
                        </button>
                      </SwipeRow>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {rows.length > 0 && (
            <section class="card">
              <div class="card-head2">
                <span class="head-ic income"><Icon name="trend" /></span>
                <div class="head-txt"><h2>Evolução</h2><small>Saldo no fim de cada mês e quanto rendeu</small></div>
                <div class="head-right"><button type="button" class="link" onClick={() => setTable(!table)}>{table ? "ocultar tabela" : "ver tabela"}</button></div>
              </div>
              <InvestChart rows={rows} />
              {table && (
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>R$</th><th>Saldo</th><th>Aportes</th><th>Rendeu</th><th>%</th></tr></thead>
                    <tbody>{rows.map((r) => (
                      <tr key={r.month}><td>{monthShort(r.month)}</td><td>{reais(r.end)}</td><td>{reais(r.flows)}</td>
                        <td class={r.yield < 0 ? "expense" : ""}>{r.updated ? reais(r.yield) : "—"}</td><td>{r.updated ? pctText(r.pct) : "—"}</td></tr>
                    ))}</tbody>
                  </table>
                  <p class="muted small">Aportes = aplicações − resgates no mês. "—" = saldos do mês ainda não informados.</p>
                </div>
              )}
            </section>
          )}

          {classes.length > 0 && total > 0 && (
            <section class="card">
              <div class="card-head2">
                <span class="head-ic brand"><Icon name="layers" /></span>
                <div class="head-txt"><h2>Divisão da carteira</h2><small>Por tipo de aplicação</small></div>
              </div>
              <div class="stack">
                {classes.map((k, i) => <div key={k} class={`seg-c${(i % 8) + 1}`} style={{ flexGrow: byClass.get(k)! }} />)}
              </div>
              <ul class="alloc">
                {classes.map((k, i) => (
                  <li key={k}><i class={`sw c${(i % 8) + 1}`} /><span>{ASSET_CLASS[k]}</span><b class="num">{moneyCompact(byClass.get(k)!)}</b><small>{Math.round((byClass.get(k)! / total) * 100)}%</small></li>
                ))}
              </ul>
            </section>
          )}
          {invs.some((a) => a.archived) && (
            <section>
              <div class="day-head bank-head"><span>Arquivados</span></div>
              <ul class="group">
                {invs.filter((a) => a.archived).map((a) => {
                  const act = accountSwipe(store, a, setToast);
                  return (
                    <SwipeRow key={a.id} id={a.id} openId={openId} setOpenId={setOpenId} left={act.left} right={act.right}>
                      <button type="button" class="row-main inv-row archived" onClick={() => store.openAccount(a)}>
                        <span class="inv-dot" style={{ background: a.color }} />
                        <span class="what"><span class="desc">{a.name}</span><span class="sub">{ASSET_CLASS[assetClassOf(a)]} · deslize para a direita para reativar</span></span>
                        <span class="right"><span class="amount num">{money(bal.get(a.id) ?? 0)}</span></span>
                      </button>
                    </SwipeRow>
                  );
                })}
              </ul>
            </section>
          )}
          <p class="muted small" style={{ textAlign: "center" }}>
            Aplicar e resgatar: toque no investimento · deslize para a esquerda para excluir. Investimentos ficam fora do saldo disponível (aba Mês) e entram no patrimônio (aba Contas).
          </p>
        </>
      )}
      <UndoToast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}

/** Saldo no fim do mês (linha) + rendimento do mês (barras: verde ganho, vermelho perda). */
function InvestChart({ rows }: { rows: InvestMonth[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const W = 340, H = 170, left = 44, right = 6, top = 10, mid = 100, bottom = 20;
  const ends = rows.map((r) => r.end);
  const lo = Math.min(...ends) * 0.97, hi = Math.max(...ends) * 1.01 || 1;
  const slot = (W - left - right) / rows.length;
  const x = (i: number) => left + slot * i + slot / 2;
  const yL = (v: number) => top + ((hi - v) * (mid - top - 8)) / (hi - lo || 1);
  const ymax = Math.max(1, ...rows.map((r) => Math.abs(r.updated ? r.yield : 0)));
  const base = mid + (H - bottom - mid) / 2 + 2;
  const hb = (H - bottom - mid) / 2 - 4;
  const s = sel !== null ? rows[sel] : null;
  return (
    <figure class="chart">
      <div class="legend"><span><i class="sw line" />Saldo</span><span><i class="sw income" />Rendimento</span></div>
      <p class="chart-detail" aria-live="polite">
        {s ? <>{monthLong(s.month)}: saldo {money(s.end)} · rendeu {s.updated ? `${signedMoney(s.yield)} (${pctText(s.pct)})` : "—"} · aportes {signedMoney(s.flows)}</> : "Toque num mês para ver os valores."}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={rows.map((r) => `${monthShort(r.month)}: saldo ${money(r.end)}, rendeu ${r.updated ? money(r.yield) : "sem dado"}`).join("; ")}>
        {[hi, (hi + lo) / 2, lo].map((v) => (
          <g key={v}><line x1={left} x2={W - right} y1={yL(v)} y2={yL(v)} class="grid" /><text x={left - 6} y={yL(v) + 3.5} class="tick" text-anchor="end">{moneyShort(v)}</text></g>
        ))}
        <line x1={left} x2={W - right} y1={base} y2={base} class="zero" />
        <text x={left - 6} y={base + 3.5} class="tick" text-anchor="end">0</text>
        {rows.map((r, i) => {
          const h = r.updated ? (Math.abs(r.yield) / ymax) * hb : 0;
          return (
            <g key={r.month} class="hit" onClick={() => setSel(sel === i ? null : i)}>
              <rect x={left + slot * i} y={0} width={slot} height={H} fill="transparent" />
              {sel === i && <rect x={left + slot * i} y={top} width={slot} height={H - top - bottom} class="sel-band" />}
              {h > 0.5 && <rect x={x(i) - Math.min(12, slot * 0.3)} width={Math.min(24, slot * 0.6)} y={r.yield >= 0 ? base - h : base} height={h} rx={3}
                style={{ fill: r.yield >= 0 ? "var(--income)" : "var(--expense)" }} />}
              <text x={x(i)} y={H - 5} class={`tick ${sel === i ? "selx" : ""}`} text-anchor="middle">{monthShort(r.month).split("/")[0]}</text>
            </g>
          );
        })}
        <path d={rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yL(r.end).toFixed(1)}`).join("")} class="sim-line" />
        {rows.map((r, i) => <circle key={r.month} cx={x(i)} cy={yL(r.end)} r={sel === i ? 4.5 : 3} class="inv-pt" />)}
      </svg>
    </figure>
  );
}

/** Atualizar os saldos dos investimentos (hoje, no mês atual; ou fim do mês anterior). */
export function ValuationSheet({ store, onClose }: { store: Store; onClose: () => void }) {
  const { data } = store;
  const cur = thisMonth();
  const today = todayISO();
  const [month, setMonth] = useState(cur);
  const date = month === cur ? today : lastDay(month);
  const active = data.accounts.filter((a) => data.investments.has(a.id) && !a.archived);
  const initialValues = (m: string, dt: string) => Object.fromEntries(active.map((a) => {
    const v = data.valuations.find((x) => x.accountId === a.id && x.month === m);
    return [a.id, v ? v.balance : investBalanceAt(data, a.id, dt)];
  }));
  const [values, setValues] = useState<Record<string, number>>(() => initialValues(cur, today));

  const pick = (m: string) => { setMonth(m); setValues(initialValues(m, m === cur ? today : lastDay(m))); };

  async function submit(e: Event) {
    e.preventDefault();
    const recs: Valuation[] = active.map((a) => ({
      id: `val:${a.id}:${month}`, t: "valuation", accountId: a.id, month, date, balance: values[a.id] ?? 0, updatedAt: 0,
    }));
    await store.put(recs);
    onClose();
  }

  return (
    <Sheet title="Atualizar saldos" onClose={onClose} onSubmit={submit}
      actions={<><button type="button" class="btn ghost" onClick={onClose}>Cancelar</button><button type="submit" class="btn primary">Salvar</button></>}>
      <div class="seg wide" role="group" aria-label="Data do saldo">
        <button type="button" class={month === cur ? "on" : ""} onClick={() => pick(cur)}>Hoje ({monthShort(cur).split("/")[0]})</button>
        <button type="button" class={month !== cur ? "on" : ""} onClick={() => pick(addMonths(cur, -1))}>Fim de {monthShort(addMonths(cur, -1)).split("/")[0]}</button>
      </div>
      <p class="muted small hint">Informe o saldo que o banco mostra. O rendimento desconta aplicações e resgates do período.</p>
      {active.map((a) => {
        const prevEnd = lastDay(addMonths(month, -1));
        const firstVal = data.valuations.find((v) => v.accountId === a.id);
        const startDate = firstVal && firstVal.date > prevEnd && firstVal.month === month ? null : prevEnd;
        const start = startDate ? investBalanceAt(data, a.id, startDate) : null;
        const flows = startDate ? investFlows(data, a.id, startDate, date) : 0;
        const y = start !== null && firstVal && firstVal.date <= date ? (values[a.id] ?? 0) - start - flows : null;
        return (
          <div key={a.id} class="val-row">
            <MoneyInput label={a.name} value={values[a.id] ?? 0} onChange={(v) => setValues({ ...values, [a.id]: v })} />
            <small class="muted">{y === null ? "primeiro saldo: ponto de partida do rendimento" : `rendeu ${signedMoney(y)} no período${flows ? ` · aportes ${signedMoney(flows)}` : ""}`}</small>
          </div>
        );
      })}
    </Sheet>
  );
}
