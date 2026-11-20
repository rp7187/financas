import { addMonths, dateInMonth, daysInMonth, monthDiff, monthOf, thisMonth, todayISO } from "./dates";
import { isCard, type Account, type Category, type Plan, type Property, type Rec, type Rule, type Txn } from "./model";

/** Registros vivos (sem os excluídos), separados por tipo. */
export type Data = {
  accounts: Account[];
  categories: Category[];
  txns: Txn[];
  rules: Rule[];
  plans: Plan[];
  properties: Property[];
  /** `${ruleId}|${mês}` já materializado (inclusive excluído = mês pulado). */
  ruleDone: Set<string>;
  /** Ids das contas que são cartão de crédito. */
  cards: Set<string>;
  /** Estimativa de gastos variáveis por mês (média dos últimos meses fechados) e quantos meses entraram na média. */
  variable: { avg: number; months: number };
};

export function indexData(records: Rec[]): Data {
  const d: Data = { accounts: [], categories: [], txns: [], rules: [], plans: [], properties: [], ruleDone: new Set(), cards: new Set(), variable: { avg: 0, months: 0 } };
  for (const r of records) {
    if (r.t === "txn" && r.ruleId && r.ruleMonth) d.ruleDone.add(`${r.ruleId}|${r.ruleMonth}`);
    if (r.deleted) continue;
    if (r.t === "account") d.accounts.push(r);
    else if (r.t === "category") d.categories.push(r);
    else if (r.t === "txn") d.txns.push(r);
    else if (r.t === "rule") d.rules.push(r);
    else if (r.t === "plan") d.plans.push(r);
    else if (r.t === "property") d.properties.push(r);
  }
  d.accounts.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "pt-BR"));
  for (const a of d.accounts) if (isCard(a)) d.cards.add(a.id);
  d.variable = variableAverage(d);
  d.categories.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  d.properties.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return d;
}

/**
 * Um item na lista do mês: lançamento gravado, previsto de um recorrente (ainda não confirmado), fatura de cartão a pagar
 * ou estimativa de gastos variáveis (meses atual e futuros).
 */
export type Item = { txn: Txn; virtual: boolean; rule?: Rule; plan?: Plan; bill?: Bill; estimate?: boolean };

/* ---------------- Estimativa de gastos variáveis ---------------- */

/** Meses fechados usados na média de gastos variáveis. */
export const VARIABLE_MONTHS = 3;

/** Gasto variável = despesa única (não recorrente, não parcela) de categoria que não é investimento. */
function isVariableSpend(t: Txn, invest: Set<string>): boolean {
  return t.type === "expense" && !t.ruleId && !t.planId && !(t.categoryId && invest.has(t.categoryId));
}
const investIds = (d: Data) => new Set(d.categories.filter((c) => c.purpose === "investment").map((c) => c.id));

/** Média mensal de gastos variáveis nos últimos meses fechados (só meses desde o 1º lançamento). */
function variableAverage(d: Data): { avg: number; months: number } {
  const cur = thisMonth();
  const first = [...d.txns.map((t) => monthOf(t.date)), ...d.rules.map((r) => r.startMonth)].sort()[0];
  if (!first) return { avg: 0, months: 0 };
  const months = Array.from({ length: VARIABLE_MONTHS }, (_, i) => addMonths(cur, -(i + 1))).filter((m) => m >= first);
  if (!months.length) return { avg: 0, months: 0 };
  const set = new Set(months);
  const invest = investIds(d);
  const total = d.txns.filter((t) => set.has(monthOf(t.date)) && isVariableSpend(t, invest)).reduce((s, t) => s + t.amount, 0);
  return { avg: Math.round(total / months.length), months: months.length };
}

/** Quanto da estimativa ainda falta no mês (média − variáveis já lançados no mês); 0 em meses passados. */
export function estimateFor(d: Data, month: string): { amount: number; spent: number } {
  if (month < thisMonth() || d.variable.avg <= 0) return { amount: 0, spent: 0 };
  const invest = investIds(d);
  const spent = d.txns.filter((t) => monthOf(t.date) === month && isVariableSpend(t, invest)).reduce((s, t) => s + t.amount, 0);
  return { amount: Math.max(0, d.variable.avg - spent), spent };
}

/** Item da estimativa: despesa prevista sem conta (entra no saldo total, não no de uma conta), no fim do mês. */
function estimateTxn(month: string, amount: number): Txn {
  return {
    id: `est:${month}`, t: "txn", updatedAt: 0, type: "expense", amount, date: `${month}-${String(daysInMonth(month)).padStart(2, "0")}`,
    description: "Gastos variáveis (estimativa)", accountId: "", paid: false,
  };
}

const ruleActive = (r: Rule, month: string) => month >= r.startMonth && (!r.endMonth || month <= r.endMonth);

/** Lançamento previsto de um recorrente num mês (não gravado). No cartão já conta como feito (entra na fatura). */
export function virtualTxn(r: Rule, month: string, onCard = false): Txn {
  return {
    id: `v:${r.id}:${month}`, t: "txn", updatedAt: 0, type: r.type, amount: r.amount, date: dateInMonth(month, r.day),
    description: r.description, categoryId: r.categoryId, accountId: r.accountId, paid: onCard, ruleId: r.id, ruleMonth: month,
    ...(r.propertyId ? { propertyId: r.propertyId } : {}),
  };
}

/** Todos os itens do mês (gravados + previstos), em ordem de data. */
export function monthItems(d: Data, month: string): Item[] {
  const rules = new Map(d.rules.map((r) => [r.id, r]));
  const plans = new Map(d.plans.map((p) => [p.id, p]));
  const items: Item[] = d.txns
    .filter((t) => monthOf(t.date) === month)
    .map((t) => ({ txn: t, virtual: false, rule: t.ruleId ? rules.get(t.ruleId) : undefined, plan: t.planId ? plans.get(t.planId) : undefined }));
  for (const r of d.rules) {
    if (ruleActive(r, month) && !d.ruleDone.has(`${r.id}|${month}`)) items.push({ txn: virtualTxn(r, month, d.cards.has(r.accountId)), virtual: true, rule: r });
  }
  for (const card of d.accounts) {
    const b = bill(d, card, month);
    if (b && b.remaining > 0) items.push({ txn: billTxn(b), virtual: true, bill: b });
  }
  const est = estimateFor(d, month);
  if (est.amount > 0) items.push({ txn: estimateTxn(month, est.amount), virtual: true, estimate: true });
  return items.sort((a, b) => a.txn.date.localeCompare(b.txn.date) || a.txn.description.localeCompare(b.txn.description, "pt-BR"));
}

/* ---------------- Cartão de crédito ---------------- */

/** Fatura de um cartão, identificada pelo mês do vencimento. Ciclo = [start, close): do fechamento anterior até o dia antes do fechamento. */
export type Bill = {
  card: Account;
  month: string; // "AAAA-MM" do vencimento
  start: string;
  close: string;
  due: string;
  total: number; // compras − estornos do ciclo
  paid: number; // pagamentos registrados para esta fatura (transferências com billFor)
  remaining: number;
};

const hasCycle = (c: Account) => isCard(c) && !!c.closingDay && !!c.dueDay;
const closeIn = (c: Account, month: string) => dateInMonth(month, c.closingDay!);
/** Mês de fechamento → mês de vencimento (vencimento depois do fechamento no mesmo mês, senão no seguinte). */
const dueMonthOfClose = (c: Account, closeMonth: string) => (c.dueDay! > c.closingDay! ? closeMonth : addMonths(closeMonth, 1));

/** Mês de vencimento da fatura em que cai uma compra feita em `date`. */
export function billMonthOf(c: Account, date: string): string {
  const m = monthOf(date);
  return dueMonthOfClose(c, date < closeIn(c, m) ? m : addMonths(m, 1));
}

/** Compras/estornos lançados no cartão com data em [start, end) — gravados e recorrentes previstos. */
function cardCharges(d: Data, cardId: string, start: string, end: string): Txn[] {
  const out = d.txns.filter((t) => t.accountId === cardId && t.type !== "transfer" && t.date >= start && t.date < end);
  for (const r of d.rules) {
    if (r.accountId !== cardId) continue;
    for (let m = monthOf(start); m <= monthOf(end); m = addMonths(m, 1)) {
      if (!ruleActive(r, m) || d.ruleDone.has(`${r.id}|${m}`)) continue;
      const v = virtualTxn(r, m, true);
      if (v.date >= start && v.date < end) out.push(v);
    }
  }
  return out;
}

/** Fatura do cartão com vencimento em `month` (null se não é cartão, sem datas configuradas ou sem movimento). */
export function bill(d: Data, card: Account, month: string): Bill | null {
  if (!hasCycle(card)) return null;
  const closeMonth = card.dueDay! > card.closingDay! ? month : addMonths(month, -1);
  const start = closeIn(card, addMonths(closeMonth, -1));
  const close = closeIn(card, closeMonth);
  const total = cardCharges(d, card.id, start, close).reduce((s, t) => s + (t.type === "income" ? -t.amount : t.amount), 0);
  const paid = d.txns.filter((t) => t.type === "transfer" && t.toAccountId === card.id && t.billFor === month).reduce((s, t) => s + t.amount, 0);
  if (total <= 0 && paid <= 0) return null;
  return { card, month, start, close, due: dateInMonth(month, card.dueDay!), total, paid, remaining: Math.max(0, total - paid) };
}

/** Item "a pagar" da fatura: transferência prevista da conta de pagamento para o cartão, no vencimento. */
export function billTxn(b: Bill): Txn {
  return {
    id: `bill:${b.card.id}:${b.month}`, t: "txn", updatedAt: 0, type: "transfer", amount: b.remaining, date: b.due,
    description: `Fatura ${b.card.name}`, accountId: b.card.payFromId ?? "", toAccountId: b.card.id, paid: false, billFor: b.month,
  };
}

/** Parcelas futuras já lançadas no cartão: comprometem o limite antes de entrar no saldo. */
export function cardFutureCharges(d: Data, cardId: string): number {
  const today = todayISO();
  return d.txns.filter((t) => t.accountId === cardId && t.type !== "transfer" && t.date > today).reduce((s, t) => s + (t.type === "income" ? -t.amount : t.amount), 0);
}

/** Primeiro mês com movimento no cartão (para somar faturas antigas ainda não pagas). */
function firstCardMonth(d: Data, cardId: string): string | null {
  let first: string | null = null;
  for (const t of d.txns) if (t.accountId === cardId && t.type !== "transfer" && (!first || t.date < first)) first = t.date;
  for (const r of d.rules) if (r.accountId === cardId && (!first || `${r.startMonth}-01` < first)) first = `${r.startMonth}-01`;
  return first && monthOf(first);
}

/** Efeito do lançamento no saldo de uma conta (ou no total, se `accountId` ausente). */
export function effect(t: Txn, accountId?: string): number {
  if (t.type === "transfer") {
    if (!accountId) return 0; // entre contas próprias: não muda o total
    return (t.toAccountId === accountId ? t.amount : 0) - (t.accountId === accountId ? t.amount : 0);
  }
  if (accountId && t.accountId !== accountId) return 0;
  return t.type === "income" ? t.amount : -t.amount;
}

export type Totals = {
  income: number; expense: number; incomePaid: number; expensePaid: number; pending: number; overdue: number;
  /** Faturas de cartão a pagar no mês (o que falta de cada uma). */
  bills: number;
  /** Estimativa de gastos variáveis ainda não lançados (fora de `expense`). */
  estimate: number;
};

/**
 * Receitas e despesas do mês (transferências não entram), opcionalmente de uma conta.
 * Compras no cartão contam como despesa do mês da compra (já feitas); o dinheiro sai na fatura, que entra em `bills`.
 */
export function monthTotals(items: Item[], accountId?: string): Totals {
  const today = todayISO();
  const tot: Totals = { income: 0, expense: 0, incomePaid: 0, expensePaid: 0, pending: 0, overdue: 0, bills: 0, estimate: 0 };
  for (const { txn: t, bill: b, estimate } of items) {
    if (estimate) { if (!accountId) tot.estimate += t.amount; continue; }
    if (b) {
      if (accountId && accountId !== t.accountId && accountId !== t.toAccountId) continue;
      tot.bills += t.amount; tot.pending++; if (t.date < today) tot.overdue++;
      continue;
    }
    if (t.type === "transfer" || (accountId && t.accountId !== accountId)) continue;
    if (t.type === "income") { tot.income += t.amount; if (t.paid) tot.incomePaid += t.amount; }
    else { tot.expense += t.amount; if (t.paid) tot.expensePaid += t.amount; }
    if (!t.paid) { tot.pending++; if (t.date < today) tot.overdue++; }
  }
  return tot;
}

/** Saldo realizado agora (só o que está pago/recebido; no cartão, também os recorrentes previstos até hoje). */
export function currentBalance(d: Data, accountId?: string): number {
  const initial = d.accounts.filter((a) => !accountId || a.id === accountId).reduce((s, a) => s + a.initialBalance, 0);
  const today = todayISO();
  // compras no cartão com data futura (parcelas) ainda não aconteceram: entram no limite, não no saldo
  const happened = (t: Txn) => t.paid && (t.type === "transfer" || !d.cards.has(t.accountId) || t.date <= today);
  let bal = d.txns.filter(happened).reduce((s, t) => s + effect(t, accountId), initial);
  for (const r of d.rules) {
    if (!d.cards.has(r.accountId) || (accountId && r.accountId !== accountId)) continue;
    for (let m = r.startMonth; m <= monthOf(today) && ruleActive(r, m); m = addMonths(m, 1)) {
      const v = virtualTxn(r, m, true);
      if (v.date <= today && !d.ruleDone.has(`${r.id}|${m}`)) bal += effect(v, accountId);
    }
  }
  return bal;
}

/**
 * Saldo previsto ao fim de cada mês, de `from` a `to` (inclui pendentes e recorrentes previstos).
 * Começa do saldo inicial das contas e soma tudo que tem data até o fim de cada mês.
 */
export function balanceByMonth(d: Data, from: string, to: string, accountId?: string): { month: string; balance: number }[] {
  const initial = d.accounts.filter((a) => !accountId || a.id === accountId).reduce((s, a) => s + a.initialBalance, 0);
  const before = d.txns.filter((t) => monthOf(t.date) < from).reduce((s, t) => s + effect(t, accountId), initial);
  // recorrentes previstos antes de `from` (meses não confirmados)
  let running = before;
  for (const r of d.rules) {
    for (let m = r.startMonth; m < from && (!r.endMonth || m <= r.endMonth); m = addMonths(m, 1)) {
      if (!d.ruleDone.has(`${r.id}|${m}`)) running += effect(virtualTxn(r, m), accountId);
      if (monthDiff(r.startMonth, m) > 600) break;
    }
  }
  // estimativa de variáveis dos meses entre o atual e `from` (só no total; não tem conta)
  if (!accountId) for (let m = thisMonth(); m < from; m = addMonths(m, 1)) running -= estimateFor(d, m).amount;
  // faturas de cartão vencidas antes de `from` e não pagas (só mudam o saldo de uma conta, não o total)
  if (accountId) {
    for (const card of d.accounts) {
      if (card.id !== accountId && card.payFromId !== accountId) continue;
      const first = firstCardMonth(d, card.id);
      for (let m = first ?? from; m < from; m = addMonths(m, 1)) {
        const b = bill(d, card, m);
        if (b && b.remaining > 0) running += effect(billTxn(b), accountId);
      }
    }
  }
  const out: { month: string; balance: number }[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) {
    running += monthItems(d, m).reduce((s, it) => s + effect(it.txn, accountId), 0);
    out.push({ month: m, balance: running });
  }
  return out;
}

/** Natureza da despesa: fixa (recorrente mensal), parcelada ou variável (lançamento único). */
export type Nature = "fixed" | "installment" | "variable";
export const natureOf = (t: Txn): Nature => (t.ruleId ? "fixed" : t.planId ? "installment" : "variable");

/** Despesas do mês separadas em fixas / parceladas / variáveis. */
export function expenseByNature(items: Item[], accountId?: string): Record<Nature, number> {
  const out: Record<Nature, number> = { fixed: 0, installment: 0, variable: 0 };
  for (const { txn: t, estimate } of items) {
    if (estimate) continue;
    if (t.type !== "expense" || (accountId && t.accountId !== accountId)) continue;
    out[natureOf(t)] += t.amount;
  }
  return out;
}

/** Despesas por imóvel nos itens dados (só lançamentos associados a imóvel). */
export function byProperty(items: Item[]) {
  const map = new Map<string, number>();
  for (const { txn: t } of items) {
    if (t.type !== "expense" || !t.propertyId) continue;
    map.set(t.propertyId, (map.get(t.propertyId) ?? 0) + t.amount);
  }
  return map;
}

/** Despesas (ou receitas) do mês por categoria, maior primeiro. */
export function byCategory(items: Item[], type: "income" | "expense", accountId?: string) {
  const map = new Map<string, number>();
  for (const { txn: t, estimate } of items) {
    if (estimate) continue;
    if (t.type !== type || (accountId && t.accountId !== accountId)) continue;
    const k = t.categoryId ?? "";
    map.set(k, (map.get(k) ?? 0) + t.amount);
  }
  return [...map.entries()].map(([categoryId, amount]) => ({ categoryId, amount })).sort((a, b) => b.amount - a.amount);
}

/** Despesas separadas em custo e investimento (pela classificação da categoria; sem a estimativa). */
export function byPurpose(d: Data, items: Item[], accountId?: string): { cost: number; investment: number } {
  const invest = investIds(d);
  const out = { cost: 0, investment: 0 };
  for (const { txn: t, estimate } of items) {
    if (estimate || t.type !== "expense" || (accountId && t.accountId !== accountId)) continue;
    if (t.categoryId && invest.has(t.categoryId)) out.investment += t.amount;
    else out.cost += t.amount;
  }
  return out;
}

/** Fixas + parcelas por mês, separadas em custo e investimento (comprometimento da renda). */
export function committedByPurpose(d: Data, items: Item[]): { cost: number; investment: number } {
  return byPurpose(d, items.filter((it) => it.rule || it.plan || it.txn.ruleId || it.txn.planId));
}
