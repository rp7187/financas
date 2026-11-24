import { DEFAULT_COLOR_ORDER, type Account, type Category, type Flow } from "./model";

/*
 * Dados iniciais com IDs FIXOS: quando a sincronização chegar (fase 2), os dois aparelhos terão
 * as mesmas categorias/conta padrão com o mesmo id e a mescla não cria duplicatas.
 */
const CATS: [string, string, Flow, string][] = [
  ["moradia", "Moradia", "expense", "🏠"],
  ["energia", "Energia elétrica", "expense", "💡"],
  ["agua", "Água", "expense", "🚿"],
  ["internet", "Internet e telefone", "expense", "📶"],
  ["mercado", "Mercado", "expense", "🛒"],
  ["restaurantes", "Restaurantes e delivery", "expense", "🍽️"],
  ["transporte", "Veículos, combustível e transporte", "expense", "🚗"],
  ["saude", "Saúde e farmácia", "expense", "🩺"], // versão 4: absorveu "Farmácia" (cat-farmacia)
  ["educacao", "Educação", "expense", "📚"],
  ["filhos", "Lucca/filhos", "expense", "🍼"],
  ["lazer", "Lazer e hobbies", "expense", "🎉"],
  ["assinaturas", "Assinaturas", "expense", "📺"],
  ["vestuario", "Vestuário", "expense", "👕"],
  ["impostos", "Impostos e taxas", "expense", "🧾"],
  ["seguros", "Seguros", "expense", "🛡️"],
  ["presentes", "Presentes", "expense", "🎁"],
  ["investimentos", "Investimentos", "expense", "💹"], // padrão desde a versão 2 dos dados iniciais
  ["outros-d", "Outros", "expense", "📦"],
  ["moveis", "Móveis e eletros", "expense", "🛋️"], // versão 7 (no fim das despesas: não muda a cor automática das outras)
  ["bebidas", "Bebidas", "expense", "🍷"], // versão 8
  ["pelucia", "Máquinas de bicho de pelúcia", "expense", "🧸"], // versão 9
  ["apostas", "Apostas", "expense", "🎲"], // versão 9
  ["salario", "Salário", "income", "💼"],
  ["13-ferias", "13º e férias", "income", "🏖️"],
  ["extra", "Extra/freelance", "income", "✨"],
  ["rendimentos", "Rendimentos", "income", "📈"],
  ["reembolso", "Reembolso", "income", "↩️"],
  ["outros-r", "Outros", "income", "📦"],
];

// Cores automáticas das categorias padrão: em sequência na lista (despesas e receitas separadas,
// para as mais comuns de cada tipo não repetirem cor). Padrões retirados mantêm a vaga na sequência
// para as cores automáticas das demais não mudarem.
const RETIRED_AFTER: Record<string, string> = { saude: "farmacia" };
DEFAULT_COLOR_ORDER.push(...CATS.filter((c) => c[2] === "expense").flatMap((c) => [c[0], ...(RETIRED_AFTER[c[0]] ? [RETIRED_AFTER[c[0]]] : [])]).map((id) => `cat-${id}`));
const incomeStart = Math.ceil(DEFAULT_COLOR_ORDER.length / 8) * 8;
CATS.filter((c) => c[2] === "income").forEach((c, i) => { DEFAULT_COLOR_ORDER[incomeStart + i] = `cat-${c[0]}`; });

/**
 * Versão dos dados iniciais. Ao acrescentar um padrão novo, suba o número: aparelhos que já usam o app
 * recebem só o que falta (por id — um padrão excluído pelo usuário tem marca de exclusão e não volta).
 */
export const DEFAULTS_VERSION = 9; // 3: categoria do usuário com mesmo nome de um padrão é substituída pelo padrão
// 4: "Farmácia" unificada em "Saúde e farmácia"; "Lazer" → "Lazer e hobbies" (ver MERGES/RENAMES)
// 5: "Transporte e combustível" → "Veículos, combustível e transporte"
// 6: Investimentos e Educação classificadas como investimento (ver PURPOSES)
// 7: nova categoria padrão "Móveis e eletros"
// 8: nova categoria padrão "Bebidas"
// 9: novas categorias padrão "Máquinas de bicho de pelúcia" e "Apostas"

/** Classificação custo/investimento de padrões: só aplica se o usuário ainda não classificou. */
export const PURPOSES: { since: number; id: string; purpose: "cost" | "investment" }[] = [
  { since: 6, id: "cat-investimentos", purpose: "investment" },
  { since: 6, id: "cat-educacao", purpose: "investment" },
];

/** Padrões unificados: os lançamentos/recorrentes/parcelamentos de `from` passam para `to` e `from` é excluído. */
export const MERGES: { since: number; from: string; to: string }[] = [
  { since: 4, from: "cat-farmacia", to: "cat-saude" },
];

/** Padrões renomeados: só renomeia se o usuário ainda não mudou o nome (ainda é `from`). */
export const RENAMES: { since: number; id: string; from: string; to: string }[] = [
  { since: 4, id: "cat-saude", from: "Saúde", to: "Saúde e farmácia" },
  { since: 4, id: "cat-lazer", from: "Lazer", to: "Lazer e hobbies" },
  { since: 5, id: "cat-transporte", from: "Transporte e combustível", to: "Veículos, combustível e transporte" },
];

/** Categorias padrão classificadas como investimento (as demais despesas são custo). */
const INVESTMENT = new Set(["investimentos", "educacao"]);

export function defaultRecords(now: number): (Category | Account)[] {
  return [
    ...CATS.map(([id, name, type, emoji]): Category => ({ id: `cat-${id}`, t: "category", name, type, emoji, updatedAt: now, ...(INVESTMENT.has(id) ? { purpose: "investment" as const } : {}) })),
    { id: "acc-principal", t: "account", name: "Conta principal", kind: "checking", initialBalance: 0, color: "#2a78d6", order: 0, updatedAt: now },
  ];
}
