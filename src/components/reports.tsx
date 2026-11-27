import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { Store } from "../app";
import { addMonths, dayMonth, monthDiff, monthLong, monthShort, thisMonth, todayISO } from "../dates";
import { monthItems, natureOf, type Data, type Item, type Nature } from "../engine";
import { PROPERTY_KIND, VEHICLE_KIND, colorOf, money, signedMoney } from "../model";
import { NATURE_LABEL } from "./charts";
import { AccountBadge, Icon } from "./icons";
import { PageHead } from "./page-head";
import { Sheet } from "./sheet";
import { CardHead } from "./stats";
import { AssetTags } from "./category-detail";

/*
 * Relatórios: uma consulta = período + filtros. O resultado mostra total, comparação com o período anterior,
 * barras por mês (realizado × previsto), agrupamento e a lista de lançamentos (exporta CSV).
 * Mesma regra das Análises: compra no cartão conta no mês da compra; transferências e faturas não entram.
 */

type Flow = "expense" | "income" | "both";
type Status = "all" | "done" | "planned";
type Group = "category" | "month" | "account" | "property" | "vehicle" | "nature";
export type Query = {
  from: string; to: string; flow: Flow; status: Status; text: string; estimate: boolean; group: Group;
  cats: string[]; accs: string[]; props: string[]; vehs: string[]; natures: Nature[];
};

const cur = () => thisMonth();
const yearOf = (m: string) => m.slice(0, 4);
const PRESETS: { id: string; label: string; range: () => [string, string] }[] = [
  { id: "month", label: "Este mês", range: () => [cur(), cur()] },
  { id: "last", label: "Mês passado", range: () => [addMonths(cur(), -1), addMonths(cur(), -1)] },
  { id: "year", label: "Este ano", range: () => [`${yearOf(cur())}-01`, `${yearOf(cur())}-12`] },
  { id: "lastYear", label: "Ano passado", range: () => { const y = Number(yearOf(cur())) - 1; return [`${y}-01`, `${y}-12`]; } },
  { id: "nextYear", label: "Próximo ano", range: () => { const y = Number(yearOf(cur())) + 1; return [`${y}-01`, `${y}-12`]; } },
  { id: "12m", label: "Últimos 12 meses", range: () => [addMonths(cur(), -11), cur()] },
];

const EMPTY: Omit<Query, "from" | "to"> = { flow: "expense", status: "all", text: "", estimate: true, group: "category", cats: [], accs: [], props: [], vehs: [], natures: [] };
const fresh = (): Query => { const [from, to] = PRESETS[2].range(); return { ...EMPTY, from, to }; };
let remembered: Query | null = null; // a consulta continua ao trocar de aba

const FLOW_LABEL: Record<Flow, string> = { expense: "Despesas", income: "Receitas", both: "Receitas e despesas" };
const STATUS_LABEL: Record<Status, string> = { all: "Realizado e previsto", done: "Só realizado", planned: "Só previsto" };
const GROUP_LABEL: Record<Group, string> = { category: "Categoria", month: "Mês", account: "Conta", property: "Imóvel", vehicle: "Veículo", nature: "Natureza" };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const months = (from: string, to: string) => Array.from({ length: Math.min(120, monthDiff(from, to) + 1) }, (_, i) => addMonths(from, i));
const rangeLabel = (from: string, to: string) => {
  if (from === to) return monthLong(from);
  if (from.endsWith("-01") && to.endsWith("-12") && yearOf(from) === yearOf(to)) return `Ano de ${yearOf(from)}`;
  return `${monthShort(from)} – ${monthShort(to)}`;
};

export type Row = Item & { planned: boolean };
/** Previsto = ainda não pago/recebido ou com data futura (recorrente no cartão já passou: conta como feito). */
const isPlanned = (it: Item, today: string) => !it.txn.paid || it.txn.date > today;
const filtersOn = (q: Query) => q.cats.length + q.accs.length + q.props.length + q.vehs.length > 0 || !!q.text.trim();

/** Lançamentos da consulta no intervalo (inclusive). */
export function runQuery(d: Data, q: Query, from = q.from, to = q.to): Row[] {
  const today = todayISO();
  const text = norm(q.text.trim());
  const out: Row[] = [];
  for (const m of months(from, to)) {
    for (const it of monthItems(d, m)) {
      const t = it.txn;
      if (it.bill || t.type === "transfer") continue;
      if (q.flow !== "both" && t.type !== q.flow) continue;
      const planned = isPlanned(it, today);
      if (q.status === "done" && planned) continue;
      if (q.status === "planned" && !planned) continue;
      // estimativa de variáveis: só sem filtros de categoria/conta/imóvel/veículo/texto (ela não tem esses dados)
      if (it.estimate) {
        if (!q.estimate || filtersOn(q) || (q.natures.length && !q.natures.includes("variable"))) continue;
        out.push({ ...it, planned: true });
        continue;
      }
      if (q.cats.length && !q.cats.includes(t.categoryId ?? "")) continue;
      if (q.accs.length && !q.accs.includes(t.accountId)) continue;
      if (q.props.length && !q.props.includes(t.propertyId ?? "")) continue;
      if (q.vehs.length && !q.vehs.includes(t.vehicleId ?? "")) continue;
      if (q.natures.length && !q.natures.includes(natureOf(t))) continue;
      if (text && !norm(t.description).includes(text)) continue;
      out.push({ ...it, planned });
    }
  }
  return out;
}

const signed = (r: Row) => (r.txn.type === "income" ? r.txn.amount : -r.txn.amount);
/** Valor do lançamento no total da consulta: positivo em despesas/receitas; com sinal em "receitas e despesas". */
const valueOf = (q: Query, r: Row) => (q.flow === "both" ? signed(r) : r.txn.amount);

export function Reports({ store, top }: { store: Store; top?: ComponentChildren }) {
  const { data } = store;
  const [q, setQ] = useState<Query>(remembered ?? fresh());
  const set = (p: Partial<Query>) => setQ((old) => { const n = { ...old, ...p }; remembered = n; return n; });
  const [pick, setPick] = useState<null | "flow" | "status" | "cats" | "accs" | "props" | "vehs" | "natures" | "period">(null);
  const [limit, setLimit] = useState(60);
  const [msg, setMsg] = useState<string | null>(null);

  const from = q.from <= q.to ? q.from : q.to;
  const to = q.from <= q.to ? q.to : q.from;
  const ms = months(from, to);
  const rows = runQuery(data, q, from, to);
  const total = rows.reduce((s, r) => s + valueOf(q, r), 0);
  const income = rows.filter((r) => r.txn.type === "income").reduce((s, r) => s + r.txn.amount, 0);
  const expense = rows.filter((r) => r.txn.type === "expense").reduce((s, r) => s + r.txn.amount, 0);
  const plannedSum = rows.filter((r) => r.planned).reduce((s, r) => s + valueOf(q, r), 0);
  const len = ms.length;
  const prevRows = runQuery(data, q, addMonths(from, -len), addMonths(to, -len));
  const prevTotal = prevRows.reduce((s, r) => s + valueOf(q, r), 0);
  const preset = PRESETS.find((p) => { const [a, b] = p.range(); return a === from && b === to; });
  const hasFuture = to >= cur();
  const realCount = rows.filter((r) => !r.estimate).length;

  // barras por mês: realizado × previsto (em "receitas e despesas", o resultado do mês)
  const byMonth = ms.map((m) => {
    const rs = rows.filter((r) => r.txn.date.slice(0, 7) === m);
    return { m, done: rs.filter((r) => !r.planned).reduce((s, r) => s + valueOf(q, r), 0), planned: rs.filter((r) => r.planned).reduce((s, r) => s + valueOf(q, r), 0) };
  });
  const barMax = Math.max(1, ...byMonth.map((b) => Math.abs(b.done + b.planned)));

  // agrupamento
  const groups = new Map<string, number>();
  const keyOf = (r: Row): string => {
    const t = r.txn;
    switch (q.group) {
      case "category": return r.estimate ? "~est" : t.categoryId ?? "";
      case "month": return t.date.slice(0, 7);
      case "account": return r.estimate ? "~est" : t.accountId;
      case "property": return t.propertyId ?? "";
      case "vehicle": return t.vehicleId ?? "";
      case "nature": return r.estimate ? "variable" : natureOf(t);
    }
  };
  for (const r of rows) groups.set(keyOf(r), (groups.get(keyOf(r)) ?? 0) + valueOf(q, r));
  const groupRows = [...groups.entries()]
    .map(([k, v]) => ({ k, v, ...describe(data, q.group, k) }))
    .sort((a, b) => (q.group === "month" ? a.k.localeCompare(b.k) : Math.abs(b.v) - Math.abs(a.v)));
  const groupMax = Math.max(1, ...groupRows.map((g) => Math.abs(g.v)));
  const drill = (k: string) => {
    if (k === "~est") return;
    if (q.group === "category") set({ cats: [k] });
    if (q.group === "month") set({ from: k, to: k });
    if (q.group === "account") set({ accs: [k] });
    if (q.group === "property") set({ props: [k] });
    if (q.group === "vehicle") set({ vehs: [k] });
    if (q.group === "nature") set({ natures: [k as Nature] });
    setLimit(60);
  };
  const groupsAvail: Group[] = ["category", "month", "account", "nature", ...(data.properties.length ? ["property" as const] : []), ...(data.vehicles.length ? ["vehicle" as const] : [])];

  // a estimativa entra no total, mas não na lista (uma linha por mês só polui)
  const estSum = rows.filter((r) => r.estimate).reduce((s, r) => s + r.txn.amount, 0);
  const list = rows.filter((r) => !r.estimate).sort((a, b) => b.txn.date.localeCompare(a.txn.date) || b.txn.amount - a.txn.amount);
  const active = filtersOn(q) || q.natures.length > 0 || q.status !== "all";
  const sign = q.flow === "both";
  const fmt = (v: number) => (sign ? signedMoney(v) : money(v));

  async function exportCsv() {
    const esc = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const name = (id: string | undefined, l: { id: string; name: string }[]) => (id ? l.find((x) => x.id === id)?.name ?? "" : "");
    const lines = [["Data", "Descrição", "Tipo", "Categoria", "Conta", "Imóvel", "Veículo", "Natureza", "Situação", "Valor"].join(";")];
    for (const r of [...list].reverse()) {
      const t = r.txn;
      lines.push([
        t.date.split("-").reverse().join("/"), t.description, t.type === "income" ? "Receita" : "Despesa",
        r.estimate ? "(estimativa)" : name(t.categoryId, data.categories), name(t.accountId, data.accounts),
        name(t.propertyId, data.properties), name(t.vehicleId, data.vehicles),
        NATURE_LABEL[r.estimate ? "variable" : natureOf(t)], r.planned ? "Previsto" : "Realizado",
        (signed(r) / 100).toFixed(2).replace(".", ","),
      ].map((x) => esc(String(x))).join(";"));
    }
    const file = `financas-${from}${from !== to ? `-a-${to}` : ""}.csv`;
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    try {
      const f = new File([blob], file, { type: "text/csv" });
      if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: file }); return; }
    } catch (e) { if ((e as Error)?.name === "AbortError") return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = file; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setMsg(`Arquivo ${file} gerado.`);
  }

  const chipLabel = (base: string, ids: string[], all: { id: string; name: string }[], none: string) =>
    !ids.length ? base : ids.length === 1 ? (ids[0] === "" ? none : all.find((x) => x.id === ids[0])?.name ?? base) : `${base} (${ids.length})`;

  return (
    <>
      <PageHead store={store} title="Análises" />
      {top}

      {/* ---------- Consulta ---------- */}
      <section class="card rep-query">
        <div class="chips scroll rep-periods" role="group" aria-label="Período">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" class={`chip ${preset?.id === p.id ? "on" : ""}`} aria-pressed={preset?.id === p.id}
              onClick={() => { const [a, b] = p.range(); set({ from: a, to: b }); setLimit(60); }}>{p.label}</button>
          ))}
          <button type="button" class={`chip ${!preset ? "on" : ""}`} onClick={() => setPick("period")}><Icon name="calendar" />{preset ? "Escolher meses" : rangeLabel(from, to)}</button>
        </div>
        <div class="chips rep-filters">
          <FilterChip on={q.flow !== "expense"} onClick={() => setPick("flow")}>{FLOW_LABEL[q.flow]}</FilterChip>
          <FilterChip on={q.cats.length > 0} onClick={() => setPick("cats")}>{chipLabel("Categorias", q.cats, data.categories, "Sem categoria")}</FilterChip>
          <FilterChip on={q.accs.length > 0} onClick={() => setPick("accs")}>{chipLabel("Contas", q.accs, data.accounts, "—")}</FilterChip>
          <FilterChip on={q.props.length > 0} onClick={() => setPick("props")}>{chipLabel("Imóveis", q.props, data.properties, "Sem imóvel")}</FilterChip>
          <FilterChip on={q.vehs.length > 0} onClick={() => setPick("vehs")}>{chipLabel("Veículos", q.vehs, data.vehicles, "Sem veículo")}</FilterChip>
          <FilterChip on={q.natures.length > 0} onClick={() => setPick("natures")}>{q.natures.length === 1 ? NATURE_LABEL[q.natures[0]] : q.natures.length ? `Natureza (${q.natures.length})` : "Natureza"}</FilterChip>
          <FilterChip on={q.status !== "all"} onClick={() => setPick("status")}>{q.status === "all" ? "Situação" : STATUS_LABEL[q.status]}</FilterChip>
        </div>
        <label class="rep-search">
          <Icon name="search" />
          <input type="search" value={q.text} placeholder="Buscar na descrição (ex.: gasolina)" onInput={(e) => { set({ text: e.currentTarget.value }); setLimit(60); }} />
        </label>
        {(active || q.flow !== "expense") && (
          <button type="button" class="link" onClick={() => { set({ ...EMPTY, from: q.from, to: q.to, group: q.group }); setLimit(60); }}>Limpar filtros</button>
        )}
      </section>

      {/* ---------- Consultas rápidas ---------- */}
      {!active && <Quick store={store} onPick={(p) => { set(p); setLimit(60); }} />}

      {/* ---------- Resultado ---------- */}
      <section class="card rep-result">
        <p class="rep-label">{FLOW_LABEL[q.flow]} · {rangeLabel(from, to)}</p>
        <div class="rep-total num">{sign ? signedMoney(total) : money(total)}</div>
        <p class="rep-sub">
          {realCount} lançamento{realCount === 1 ? "" : "s"}
          {len > 1 && <> · média <b class="num">{sign ? signedMoney(Math.round(total / len)) : money(Math.round(total / len))}</b>/mês</>}
        </p>
        {sign && <p class="rep-sub">Receitas <b class="num">{money(income)}</b> · despesas <b class="num">{money(expense)}</b></p>}
        {plannedSum !== 0 && (
          <p class="rep-sub">Realizado <b class="num">{fmt(total - plannedSum)}</b> · previsto <b class="num">{fmt(plannedSum)}</b></p>
        )}
        {prevTotal !== 0 && (
          <p class="rep-sub">
            <Compare v={total - prevTotal} pct={Math.round(((total - prevTotal) / Math.abs(prevTotal)) * 100)} flow={q.flow} /> vs {rangeLabel(addMonths(from, -len), addMonths(to, -len))} ({sign ? signedMoney(prevTotal) : money(prevTotal)})
          </p>
        )}
        {hasFuture && q.flow !== "income" && !filtersOn(q) && (
          <label class="toggle rep-toggle">
            <input type="checkbox" checked={q.estimate} onChange={(e) => set({ estimate: e.currentTarget.checked })} />
            <span>Incluir estimativa de gastos variáveis{data.variable.avg ? ` (${money(data.variable.avg)}/mês)` : ""}</span>
          </label>
        )}

        {len > 1 && (
          <div class="rep-bars" role="img" aria-label="Valores por mês">
            {byMonth.map((b) => {
              const h = (v: number) => `${(Math.abs(v) / barMax) * 100}%`;
              return (
                <button key={b.m} type="button" class="rep-bar" title={`${monthShort(b.m)}: ${money(Math.abs(b.done + b.planned))}`} onClick={() => { set({ from: b.m, to: b.m }); setLimit(60); }}>
                  <span class="rep-bar-track">
                    <i class={`planned ${sign && b.done + b.planned < 0 ? "neg" : ""}`} style={{ height: h(b.planned) }} />
                    <i class={`done ${sign && b.done + b.planned < 0 ? "neg" : ""}`} style={{ height: h(b.done) }} />
                  </span>
                  <small>{monthShort(b.m).slice(0, 3)}</small>
                </button>
              );
            })}
          </div>
        )}
        {len > 1 && <p class="muted small rep-legend"><i class="sw done" /> realizado <i class="sw planned" /> previsto · toque num mês para ver só ele</p>}
      </section>

      {rows.length > 0 && (
        <section class="card">
          <CardHead icon="layers" tone="brand" title="Agrupar por" />
          <div class="chips scroll rep-group-chips">
            {groupsAvail.map((g) => (
              <button key={g} type="button" class={`chip ${q.group === g ? "on" : ""}`} aria-pressed={q.group === g} onClick={() => set({ group: g })}>{GROUP_LABEL[g]}</button>
            ))}
          </div>
          <ul class="rank rep-groups">
            {groupRows.map((g) => (
              <li key={g.k} class={g.k === "~est" ? "" : "rank-tap"} role={g.k === "~est" ? undefined : "button"} tabIndex={g.k === "~est" ? undefined : 0}
                onClick={() => drill(g.k)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); drill(g.k); } }}>
                {g.icon}
                <div class="rank-main">
                  <div class="rank-top"><span class="name">{g.label}</span><b class="num">{sign ? signedMoney(g.v) : money(g.v)}</b></div>
                  <div class="hbar"><div class={`fill ${g.color}`} style={{ width: `${(Math.abs(g.v) / groupMax) * 100}%` }} /></div>
                  {!sign && total > 0 && <div class="rank-meta"><span>{Math.round((g.v / total) * 100)}%</span></div>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section class="card">
        <CardHead icon="tag" tone="brand" title={`Lançamentos (${realCount})`}
          right={rows.length > 0 ? <button type="button" class="link" onClick={exportCsv}><Icon name="download" />CSV</button> : undefined} />
        {msg && <p class="note" role="status">{msg}</p>}
        {!rows.length && <p class="muted small">Nenhum lançamento com esses filtros.</p>}
        {estSum > 0 && <p class="muted small">O total inclui {money(estSum)} de gastos variáveis estimados (média dos últimos meses), que não aparecem na lista.</p>}
        <ul class="group cat-list">
          {list.slice(0, limit).map((r) => {
            const t = r.txn;
            const cat = data.categories.find((c) => c.id === t.categoryId);
            const acc = data.accounts.find((a) => a.id === t.accountId);
            const extra = r.plan ? ` · ${t.installment}/${r.plan.count}` : r.rule ? " · mensal" : "";
            return (
              <li key={t.id}>
                <button type="button" class="row-main cat-row" disabled={r.estimate} onClick={() => store.openTxn(r)}>
                  <span class="cat-date num">{dayMonth(t.date)}<small>{len > 12 || yearOf(from) !== yearOf(to) ? `/${t.date.slice(2, 4)}` : ""}</small></span>
                  <span class="what">
                    <span class="desc">{t.description}</span>
                    <span class="sub">{r.estimate ? "média dos últimos meses" : `${cat ? `${cat.emoji} ${cat.name}` : "Sem categoria"} · ${acc?.name ?? "?"}${extra}`}</span>
                  </span>
                  <span class="right">
                    <span class={`amount num ${t.type}`}>{t.type === "income" ? "+" : "−"}{money(t.amount)}</span>
                    <AssetTags data={data} t={t} />
                    {r.planned && <span class="pill">previsto</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {list.length > limit && <button type="button" class="btn ghost wide" onClick={() => setLimit(limit + 100)}>Mostrar mais ({list.length - limit})</button>}
      </section>

      {pick === "period" && <PeriodSheet from={from} to={to} onDone={(a, b) => { set({ from: a, to: b }); setLimit(60); setPick(null); }} onClose={() => setPick(null)} />}
      {pick === "flow" && <ChoiceSheet title="Tipo" value={q.flow} options={(["expense", "income", "both"] as Flow[]).map((k) => ({ id: k, label: FLOW_LABEL[k] }))} onPick={(v) => { set({ flow: v as Flow, cats: [] }); setPick(null); }} onClose={() => setPick(null)} />}
      {pick === "status" && <ChoiceSheet title="Situação" value={q.status} options={(["all", "done", "planned"] as Status[]).map((k) => ({ id: k, label: STATUS_LABEL[k] }))} onPick={(v) => { set({ status: v as Status }); setPick(null); }} onClose={() => setPick(null)} />}
      {pick === "cats" && <MultiSheet title="Categorias" value={q.cats} onDone={(v) => { set({ cats: v }); setPick(null); }} onClose={() => setPick(null)}
        options={data.categories.filter((c) => q.flow === "both" || c.type === q.flow).map((c) => ({ id: c.id, label: c.name, icon: <span class={`avatar ${colorOf(c)}`}>{c.emoji}</span>, sub: c.archived ? "arquivada" : q.flow === "both" ? (c.type === "income" ? "receita" : "despesa") : undefined }))} />}
      {pick === "accs" && <MultiSheet title="Contas e cartões" value={q.accs} onDone={(v) => { set({ accs: v }); setPick(null); }} onClose={() => setPick(null)}
        options={data.accounts.filter((a) => !data.investments.has(a.id)).map((a) => ({ id: a.id, label: a.name, icon: <AccountBadge a={a} />, sub: a.archived ? "arquivada" : undefined }))} />}
      {pick === "props" && !data.properties.length && <EmptyPick title="Imóveis" what="imóvel" onAdd={() => { setPick(null); store.openProperty(null); }} onClose={() => setPick(null)} />}
      {pick === "vehs" && !data.vehicles.length && <EmptyPick title="Veículos" what="veículo" onAdd={() => { setPick(null); store.openVehicle(null); }} onClose={() => setPick(null)} />}
      {pick === "props" && data.properties.length > 0 && <MultiSheet title="Imóveis" value={q.props} onDone={(v) => { set({ props: v }); setPick(null); }} onClose={() => setPick(null)}
        options={[...data.properties.map((p) => ({ id: p.id, label: p.name, icon: <span class={`avatar ${colorOf(p)}`}>{PROPERTY_KIND[p.kind].emoji}</span> })), { id: "", label: "Sem imóvel" }]} />}
      {pick === "vehs" && data.vehicles.length > 0 && <MultiSheet title="Veículos" value={q.vehs} onDone={(v) => { set({ vehs: v }); setPick(null); }} onClose={() => setPick(null)}
        options={[...data.vehicles.map((v) => ({ id: v.id, label: v.name, icon: <span class={`avatar ${colorOf(v)}`}>{VEHICLE_KIND[v.kind].emoji}</span> })), { id: "", label: "Sem veículo" }]} />}
      {pick === "natures" && <MultiSheet title="Natureza" value={q.natures} onDone={(v) => { set({ natures: v as Nature[] }); setPick(null); }} onClose={() => setPick(null)}
        options={(["fixed", "installment", "variable"] as Nature[]).map((k) => ({ id: k, label: NATURE_LABEL[k], icon: <i class={`sw ${k} rep-sw`} />, sub: k === "fixed" ? "recorrentes mensais" : k === "installment" ? "parcelamentos" : "lançamentos únicos" }))} />}
    </>
  );
}

/** Nome, ícone e cor de um grupo. */
function describe(d: Data, g: Group, k: string): { label: string; icon: ComponentChildren; color: string } {
  const dot = (c: string, e: string) => <span class={`avatar ${c}`} aria-hidden="true">{e}</span>;
  if (k === "~est") return { label: "Gastos variáveis (estimativa)", icon: dot("c8", "≈"), color: "c8" };
  if (g === "category") { const c = d.categories.find((x) => x.id === k); const col = colorOf({ id: k, color: c?.color }); return { label: c?.name ?? "Sem categoria", icon: dot(col, c?.emoji ?? "•"), color: col }; }
  if (g === "month") return { label: monthLong(k), icon: dot("c1", k.slice(5, 7)), color: "c1" };
  if (g === "account") { const a = d.accounts.find((x) => x.id === k); return { label: a?.name ?? "?", icon: a ? <span class="rep-badge"><AccountBadge a={a} /></span> : dot("c8", "?"), color: "c1" }; }
  if (g === "property") { const p = d.properties.find((x) => x.id === k); return p ? { label: p.name, icon: dot(colorOf(p), PROPERTY_KIND[p.kind].emoji), color: colorOf(p) } : { label: "Sem imóvel", icon: dot("c8", "–"), color: "c8" }; }
  if (g === "vehicle") { const v = d.vehicles.find((x) => x.id === k); return v ? { label: v.name, icon: dot(colorOf(v), VEHICLE_KIND[v.kind].emoji), color: colorOf(v) } : { label: "Sem veículo", icon: dot("c8", "–"), color: "c8" }; }
  const n = k as Nature;
  return { label: NATURE_LABEL[n], icon: <span class="rep-badge"><i class={`sw ${n} rep-sw`} /></span>, color: n === "fixed" ? "c1" : n === "installment" ? "c5" : "c3" };
}

function Compare({ v, pct, flow }: { v: number; pct: number; flow: Flow }) {
  if (Math.abs(v) < 1) return <span class="delta flat">= igual</span>;
  const good = flow === "expense" ? v < 0 : v > 0;
  return <span class={`delta ${good ? "good" : "bad"}`}>{v > 0 ? "▲" : "▼"} {money(Math.abs(v))} ({Math.abs(pct)}%)</span>;
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ComponentChildren }) {
  return <button type="button" class={`chip filter ${on ? "on" : ""}`} aria-pressed={on} onClick={onClick}>{children}<span class="caret" aria-hidden="true">▾</span></button>;
}

/** Consultas prontas (aparecem sem filtros ativos). */
function Quick({ store, onPick }: { store: Store; onPick: (p: Partial<Query>) => void }) {
  const { data } = store;
  const y = Number(yearOf(cur()));
  const yr = (n: number): [string, string] => [`${n}-01`, `${n}-12`];
  const items: { label: string; sub: string; icon: "trend" | "tag" | "home" | "car" | "down" | "calendar"; q: Partial<Query> }[] = [
    { label: `Previsto para ${y + 1}`, sub: "despesas do próximo ano, por mês", icon: "trend", q: { ...EMPTY, from: yr(y + 1)[0], to: yr(y + 1)[1], group: "month" } },
    { label: `${y} por categoria`, sub: "despesas deste ano", icon: "tag", q: { ...EMPTY, from: yr(y)[0], to: yr(y)[1], group: "category" } },
    { label: "Mês passado por categoria", sub: monthLong(addMonths(cur(), -1)), icon: "calendar", q: { ...EMPTY, from: addMonths(cur(), -1), to: addMonths(cur(), -1), group: "category" } },
    ...(data.vehicles.length ? [{ label: `Veículos em ${y}`, sub: "custo de cada veículo", icon: "car" as const, q: { ...EMPTY, from: yr(y)[0], to: yr(y)[1], group: "vehicle" as const, vehs: data.vehicles.map((v) => v.id) } }] : []),
    ...(data.properties.length ? [{ label: `Imóveis em ${y}`, sub: "custo de cada imóvel", icon: "home" as const, q: { ...EMPTY, from: yr(y)[0], to: yr(y)[1], group: "property" as const, props: data.properties.map((p) => p.id) } }] : []),
    { label: `Receitas de ${y}`, sub: "por mês", icon: "down", q: { ...EMPTY, flow: "income", from: yr(y)[0], to: yr(y)[1], group: "month" } },
  ];
  return (
    <div class="rep-quick">
      {items.map((it) => (
        <button key={it.label} type="button" class="rep-quick-item" onClick={() => onPick(it.q)}>
          <span class="head-ic brand"><Icon name={it.icon} /></span>
          <span class="grow"><b>{it.label}</b><small>{it.sub}</small></span>
        </button>
      ))}
    </div>
  );
}

function PeriodSheet({ from, to, onDone, onClose }: { from: string; to: string; onDone: (a: string, b: string) => void; onClose: () => void }) {
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const err = !a || !b ? "Escolha os dois meses." : monthDiff(a <= b ? a : b, a <= b ? b : a) > 119 ? "No máximo 10 anos." : null;
  return (
    <Sheet title="Período" onClose={onClose} onSubmit={(e) => { e.preventDefault(); if (!err) onDone(a <= b ? a : b, a <= b ? b : a); }}
      actions={<><button type="button" class="btn ghost" onClick={onClose}>Cancelar</button><button type="submit" class="btn primary">Aplicar</button></>}>
      <div class="two">
        <label>De<input type="month" value={a} onInput={(e) => setA(e.currentTarget.value)} /></label>
        <label>Até<input type="month" value={b} onInput={(e) => setB(e.currentTarget.value)} /></label>
      </div>
      {err && <p class="error">{err}</p>}
    </Sheet>
  );
}

/** Filtro de imóvel/veículo sem nenhum cadastrado: explica e oferece cadastrar. */
function EmptyPick({ title, what, onAdd, onClose }: { title: string; what: string; onAdd: () => void; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose} onSubmit={(e) => { e.preventDefault(); onAdd(); }}
      actions={<><button type="button" class="btn ghost" onClick={onClose}>Fechar</button><button type="submit" class="btn primary">Cadastrar {what}</button></>}>
      <p class="muted">Nenhum {what} cadastrado ainda. Cadastre e, ao lançar uma despesa, escolha o {what} — aí dá para filtrar aqui e ver quanto ele custa por mês e por ano.</p>
    </Sheet>
  );
}

function ChoiceSheet({ title, value, options, onPick, onClose }: { title: string; value: string; options: { id: string; label: string }[]; onPick: (v: string) => void; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose} onSubmit={(e) => { e.preventDefault(); onClose(); }} actions={<button type="button" class="btn ghost" onClick={onClose}>Cancelar</button>}>
      <ul class="ios-list pick-list">
        {options.map((o) => (
          <li key={o.id}><button type="button" class="ios-row" onClick={() => onPick(o.id)}><span class="grow">{o.label}</span>{o.id === value && <Icon name="check" class="pick-check" />}</button></li>
        ))}
      </ul>
    </Sheet>
  );
}

function MultiSheet({ title, value, options, onDone, onClose }: {
  title: string; value: string[]; options: { id: string; label: string; icon?: ComponentChildren; sub?: string }[]; onDone: (v: string[]) => void; onClose: () => void;
}) {
  const [sel, setSel] = useState<string[]>(value);
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  return (
    <Sheet title={title} onClose={onClose} onSubmit={(e) => { e.preventDefault(); onDone(sel); }}
      actions={<><button type="button" class="btn ghost" onClick={() => onDone([])}>Todas</button><button type="submit" class="btn primary">Aplicar{sel.length ? ` (${sel.length})` : ""}</button></>}>
      <p class="muted small">Nenhuma marcada = todas.</p>
      <ul class="ios-list pick-list">
        {options.map((o) => (
          <li key={o.id || "none"}>
            <button type="button" class="ios-row" aria-pressed={sel.includes(o.id)} onClick={() => toggle(o.id)}>
              {o.icon ?? <span class="ic" />}
              <span class="grow"><span>{o.label}</span>{o.sub && <small>{o.sub}</small>}</span>
              <span class={`pick-box ${sel.includes(o.id) ? "on" : ""}`}>{sel.includes(o.id) && <Icon name="check" />}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
