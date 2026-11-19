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
  ["transporte", "Transporte e combustível", "expense", "🚗"],
  ["saude", "Saúde", "expense", "🩺"],
  ["farmacia", "Farmácia", "expense", "💊"],
  ["educacao", "Educação", "expense", "📚"],
  ["filhos", "Lucca/filhos", "expense", "🍼"],
  ["lazer", "Lazer", "expense", "🎉"],
  ["assinaturas", "Assinaturas", "expense", "📺"],
  ["vestuario", "Vestuário", "expense", "👕"],
  ["impostos", "Impostos e taxas", "expense", "🧾"],
  ["seguros", "Seguros", "expense", "🛡️"],
  ["presentes", "Presentes", "expense", "🎁"],
  ["investimentos", "Investimentos", "expense", "💹"], // padrão desde a versão 2 dos dados iniciais
  ["outros-d", "Outros", "expense", "📦"],
  ["salario", "Salário", "income", "💼"],
  ["13-ferias", "13º e férias", "income", "🏖️"],
  ["extra", "Extra/freelance", "income", "✨"],
  ["rendimentos", "Rendimentos", "income", "📈"],
  ["reembolso", "Reembolso", "income", "↩️"],
  ["outros-r", "Outros", "income", "📦"],
];

// Cores automáticas das categorias padrão: em sequência na lista (despesas e receitas separadas,
// para as mais comuns de cada tipo não repetirem cor).
DEFAULT_COLOR_ORDER.push(...CATS.filter((c) => c[2] === "expense").map((c) => `cat-${c[0]}`));
const incomeStart = Math.ceil(DEFAULT_COLOR_ORDER.length / 8) * 8;
CATS.filter((c) => c[2] === "income").forEach((c, i) => { DEFAULT_COLOR_ORDER[incomeStart + i] = `cat-${c[0]}`; });

/**
 * Versão dos dados iniciais. Ao acrescentar um padrão novo, suba o número: aparelhos que já usam o app
 * recebem só o que falta (por id — um padrão excluído pelo usuário tem marca de exclusão e não volta).
 */
export const DEFAULTS_VERSION = 3; // 3: categoria do usuário com mesmo nome de um padrão é substituída pelo padrão

export function defaultRecords(now: number): (Category | Account)[] {
  return [
    ...CATS.map(([id, name, type, emoji]): Category => ({ id: `cat-${id}`, t: "category", name, type, emoji, updatedAt: now })),
    { id: "acc-principal", t: "account", name: "Conta principal", kind: "checking", initialBalance: 0, color: "#2a78d6", order: 0, updatedAt: now },
  ];
}
