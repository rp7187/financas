import { addMonths, dateInMonth, monthDiff, monthOf, todayISO } from "./dates";
import type { Account, Category, Plan, Rec, Rule, Txn } from "./model";

/** Registros vivos (sem os excluídos), separados por tipo. */
export type Data = {
  accounts: Account[];
  categories: Category[];
  txns: Txn[];
  rules: Rule[];
  plans: Plan[];
  /** `${ruleId}|${mês}` já materializado (inclusive excluído = mês pulado). */
  ruleDone: Set<string>;
};

export function indexData(records: Rec[]): Data {
  const d: Data = { accounts: [], categories: [], txns: [], rules: [], plans: [], ruleDone: new Set() };
  for (const r of records) {
    if (r.t === "txn" && r.ruleId && r.ruleMonth) d.ruleDone.add(`${r.ruleId}|${r.ruleMonth}`);
    if (r.deleted) continue;
    if (r.t === "account") d.accounts.push(r);
    else if (r.t === "category") d.categories.push(r);
    else if (r.t === "txn") d.txns.push(r);
    else if (r.t === "rule") d.rules.push(r);
    else if (r.t === "plan") d.plans.push(r);
  }
  d.accounts.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "pt-BR"));
  d.categories.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return d;
}

/** Um item na lista do mês: lançamento gravado ou previsto de um recorrente (ainda não confirmado). */
export type Item = { txn: Txn; virtual: boolean; rule?: Rule; plan?: Plan };

const ruleActive = (r: Rule, month: string) => month >= r.startMonth && (!r.endMonth || month <= r.endMonth);

/** Lançamento previsto de um recorrente num mês (não gravado). */
export function virtualTxn(r: Rule, month: string): Txn {
  return {
    id: `v:${r.id}:${month}`, t: "txn", updatedAt: 0, type: r.type, amount: r.amount, date: dateInMonth(month, r.day),
    description: r.description, categoryId: r.categoryId, accountId: r.accountId, paid: false, ruleId: r.id, ruleMonth: month,
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
    if (ruleActive(r, month) && !d.ruleDone.has(`${r.id}|${month}`)) items.push({ txn: virtualTxn(r, month), virtual: true, rule: r });
  }
  return items.sort((a, b) => a.txn.date.localeCompare(b.txn.date) || a.txn.description.localeCompare(b.txn.description, "pt-BR"));
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

export type Totals = { income: number; expense: number; incomePaid: number; expensePaid: number; pending: number; overdue: number };

/** Receitas e despesas do mês (transferências não entram), opcionalmente de uma conta. */
export function monthTotals(items: Item[], accountId?: string): Totals {
  const today = todayISO();
  const tot: Totals = { income: 0, expense: 0, incomePaid: 0, expensePaid: 0, pending: 0, overdue: 0 };
  for (const { txn: t } of items) {
    if (t.type === "transfer" || (accountId && t.accountId !== accountId)) continue;
    if (t.type === "income") { tot.income += t.amount; if (t.paid) tot.incomePaid += t.amount; }
    else { tot.expense += t.amount; if (t.paid) tot.expensePaid += t.amount; }
    if (!t.paid) { tot.pending++; if (t.date < today) tot.overdue++; }
  }
  return tot;
}

/** Saldo realizado agora (só o que está pago/recebido). */
export function currentBalance(d: Data, accountId?: string): number {
  const initial = d.accounts.filter((a) => !accountId || a.id === accountId).reduce((s, a) => s + a.initialBalance, 0);
  return d.txns.filter((t) => t.paid).reduce((s, t) => s + effect(t, accountId), initial);
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
  const out: { month: string; balance: number }[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) {
    running += monthItems(d, m).reduce((s, it) => s + effect(it.txn, accountId), 0);
    out.push({ month: m, balance: running });
  }
  return out;
}

/** Despesas (ou receitas) do mês por categoria, maior primeiro. */
export function byCategory(items: Item[], type: "income" | "expense", accountId?: string) {
  const map = new Map<string, number>();
  for (const { txn: t } of items) {
    if (t.type !== type || (accountId && t.accountId !== accountId)) continue;
    const k = t.categoryId ?? "";
    map.set(k, (map.get(k) ?? 0) + t.amount);
  }
  return [...map.entries()].map(([categoryId, amount]) => ({ categoryId, amount })).sort((a, b) => b.amount - a.amount);
}
