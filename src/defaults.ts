import type { Account, Category, Flow } from "./model";

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
  ["outros-d", "Outros", "expense", "📦"],
  ["salario", "Salário", "income", "💼"],
  ["13-ferias", "13º e férias", "income", "🏖️"],
  ["extra", "Extra/freelance", "income", "✨"],
  ["rendimentos", "Rendimentos", "income", "📈"],
  ["reembolso", "Reembolso", "income", "↩️"],
  ["outros-r", "Outros", "income", "📦"],
];

export function defaultRecords(now: number): (Category | Account)[] {
  return [
    ...CATS.map(([id, name, type, emoji]): Category => ({ id: `cat-${id}`, t: "category", name, type, emoji, updatedAt: now })),
    { id: "acc-principal", t: "account", name: "Conta principal", kind: "checking", initialBalance: 0, color: "#2a78d6", order: 0, updatedAt: now },
  ];
}
