/*
 * Modelo de dados. Tudo fica num único store ("records") como registros independentes,
 * cada um com `updatedAt` e marca de exclusão (`deleted`): é isso que permite, na fase 2,
 * sincronizar e mesclar alterações de vários aparelhos/pessoas (vale a última alteração por registro).
 * Valores em CENTAVOS (inteiros). Datas "AAAA-MM-DD"; meses "AAAA-MM".
 */

export type Base = {
  id: string;
  updatedAt: number;
  deleted?: true;
  /** Quem registrou (preenchido quando houver login/família — fase 2). */
  by?: string;
};

export type AccountKind = "checking" | "savings" | "cash" | "investment" | "credit";
export type Account = Base & {
  t: "account";
  name: string;
  kind: AccountKind;
  initialBalance: number; // centavos (cartão: negativo = dívida)
  color: string;
  archived?: boolean;
  order: number;
  // Só cartão de crédito (kind "credit"):
  /** Conta de onde sai o pagamento da fatura. */
  payFromId?: string;
  /** Dia do fechamento (1..31): compras a partir deste dia vão para a fatura seguinte. */
  closingDay?: number;
  /** Dia do vencimento da fatura (1..31). */
  dueDay?: number;
  /** Limite, em centavos (opcional). */
  limit?: number;
  // Só investimentos (kind "investment" ou "savings"):
  /** Conta do mesmo banco (de onde costuma vir o aporte e para onde vai o resgate). */
  bankId?: string;
  /** Tipo de aplicação (para ver a divisão da carteira). */
  assetClass?: AssetClass;
};

export type AssetClass = "fixed" | "treasury" | "stocks" | "reits" | "funds" | "pension" | "crypto" | "savings" | "other";
export const ASSET_CLASS: Record<AssetClass, string> = {
  fixed: "Renda fixa (CDB, LCI, LCA)",
  treasury: "Tesouro Direto",
  stocks: "Ações",
  reits: "Fundos imobiliários",
  funds: "Fundos",
  pension: "Previdência",
  crypto: "Cripto",
  savings: "Poupança",
  other: "Outro",
};
/** Investimento (aplicação ou poupança): saldo acompanhado pelo valor informado, fora do "disponível". */
export const isInvestAccount = (a: Account | undefined): boolean => a?.kind === "investment" || a?.kind === "savings";
/** Tipo de aplicação (poupança antiga sem tipo = poupança). */
export const assetClassOf = (a: Account): AssetClass => a.assetClass ?? (a.kind === "savings" ? "savings" : "other");

/**
 * Saldo informado de um investimento (o valor que o banco mostra), um por conta por mês: id fixo
 * `val:<conta>:<mês>` (dois aparelhos não duplicam). O rendimento sai da diferença entre saldos, descontando
 * aportes e resgates (transferências).
 */
export type Valuation = Base & {
  t: "valuation";
  accountId: string;
  month: string; // "AAAA-MM"
  date: string; // dia em que o saldo foi conferido
  balance: number; // centavos
};

export const isCard = (a: Account | undefined): boolean => a?.kind === "credit";

export type Flow = "income" | "expense";
export type Category = Base & {
  t: "category";
  name: string;
  type: Flow;
  emoji: string;
  archived?: boolean;
  /** Cor da categoria ("c1".."c8", paleta validada); ausente = cor automática estável (colorOf). */
  color?: string;
  /** Só despesas: custo (consumo) ou investimento (constrói patrimônio). Ausente = custo. */
  purpose?: "cost" | "investment";
};

export const isInvestment = (c: Category | undefined): boolean => c?.type === "expense" && c.purpose === "investment";

/** Imóvel: para associar custos (opcional nas despesas). */
export type PropertyKind = "apartment" | "house" | "beach" | "farm" | "land" | "commercial" | "other";
export type Property = Base & {
  t: "property";
  name: string;
  kind: PropertyKind;
  note?: string;
  archived?: boolean;
  color?: string; // "c1".."c8"; ausente = automática
};

/** Lançamento efetivo (único, parcela, ou mês de um recorrente que foi confirmado/ajustado). */
export type Txn = Base & {
  t: "txn";
  type: Flow | "transfer";
  amount: number; // centavos, sempre positivo
  date: string;
  description: string;
  categoryId?: string; // não se aplica a transferência
  accountId: string; // origem (transferência) ou conta do lançamento
  toAccountId?: string; // destino (transferência)
  paid: boolean;
  planId?: string; // parcela de um parcelamento
  installment?: number; // 1..count
  ruleId?: string; // mês de um recorrente
  ruleMonth?: string; // "AAAA-MM" do recorrente (um registro excluído aqui = "pular este mês")
  propertyId?: string; // imóvel associado (opcional)
  vehicleId?: string; // veículo associado (opcional)
  billFor?: string; // pagamento de fatura: "AAAA-MM" do vencimento da fatura paga (transferência para o cartão)
};

/** Recorrente mensal: gera um lançamento previsto por mês (sem gravar nada até ser confirmado/ajustado). */
export type Rule = Base & {
  t: "rule";
  type: Flow;
  amount: number;
  description: string;
  categoryId: string;
  accountId: string;
  day: number; // 1..31 (meses mais curtos usam o último dia)
  startMonth: string;
  endMonth?: string; // inclusive; ausente = sem fim
  propertyId?: string;
  vehicleId?: string;
};

/** Parcelamento: total dividido em `count` parcelas mensais (cada parcela é um Txn com planId). */
export type Plan = Base & {
  t: "plan";
  type: Flow;
  total: number;
  count: number;
  description: string;
  categoryId: string;
  accountId: string;
  firstDate: string;
  propertyId?: string;
  vehicleId?: string;
};

/** Veículo: para associar custos (opcional nas despesas), como os imóveis. */
export type VehicleKind = "car" | "moto" | "pickup" | "boat" | "other";
export type Vehicle = Base & {
  t: "vehicle";
  name: string;
  kind: VehicleKind;
  plate?: string;
  note?: string;
  archived?: boolean;
  color?: string; // "c1".."c8"; ausente = automática
};

export const VEHICLE_KIND: Record<VehicleKind, { label: string; emoji: string }> = {
  car: { label: "Carro", emoji: "🚗" },
  moto: { label: "Moto", emoji: "🏍️" },
  pickup: { label: "Caminhonete", emoji: "🛻" },
  boat: { label: "Barco/jet", emoji: "🚤" },
  other: { label: "Outro", emoji: "🚙" },
};

export type Rec = Account | Category | Txn | Rule | Plan | Property | Vehicle | Valuation;

export const PROPERTY_KIND: Record<PropertyKind, { label: string; emoji: string }> = {
  apartment: { label: "Apartamento", emoji: "🏢" },
  house: { label: "Casa", emoji: "🏡" },
  beach: { label: "Praia", emoji: "🏖️" },
  farm: { label: "Sítio", emoji: "🌾" },
  land: { label: "Terreno", emoji: "🌳" },
  commercial: { label: "Comercial", emoji: "🏬" },
  other: { label: "Outro", emoji: "📍" },
};

export const KIND_LABEL: Record<AccountKind, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Dinheiro/carteira",
  investment: "Investimento",
  credit: "Cartão de crédito",
};

/** Cores para contas (paleta categórica validada). */
export const ACCOUNT_COLORS = ["#2a78d6", "#eb6834", "#199e70", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948", "#16171b"];
/** Preto (cartões "black"): só por escolha; não entra na sugestão automática de cor. */
export const BLACK = "#16171b";

/** Paleta categórica (8 cores validadas nos temas claro/escuro, ver styles.css --c1..--c8). */
export const PALETTE = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"] as const;
const hash = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
/** Ordem das categorias padrão: espalha as cores entre elas (preenchida por defaults.ts). */
export const DEFAULT_COLOR_ORDER: string[] = [];
/**
 * Cor de uma categoria/imóvel: a escolhida pelo usuário ou uma automática ESTÁVEL (pelo id),
 * para que a cor acompanhe o item em todos os gráficos — nunca a posição no ranking.
 */
export function colorOf(r: { id: string; color?: string }): string {
  if (r.color && (PALETTE as readonly string[]).includes(r.color)) return r.color;
  const i = DEFAULT_COLOR_ORDER.indexOf(r.id);
  return PALETTE[(i >= 0 ? i : hash(r.id)) % PALETTE.length];
}

export const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
/** 123456 → "R$ 1.234,56" */
export const money = (cents: number) => brl.format(cents / 100);
/** Para espaços pequenos: sem centavos a partir de R$ 1.000 ("R$ 10.500") */
export const moneyCompact = (cents: number) =>
  Math.abs(cents) >= 100_000 ? `${cents < 0 ? "-" : ""}R$ ${Math.round(Math.abs(cents) / 100).toLocaleString("pt-BR")}` : brl.format(cents / 100);
/** Com sinal explícito: "+R$ 10,00" / "−R$ 10,00" */
export const signedMoney = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${brl.format(Math.abs(cents) / 100)}`;
/** Tabelas: reais sem centavos e sem "R$" (a coluna informa) — "8.000", "−3.100" */
export const reais = (cents: number) => `${cents < 0 ? "−" : ""}${Math.round(Math.abs(cents) / 100).toLocaleString("pt-BR")}`;
/** Compacto para eixos: "R$ 1,2 mil" */
export const moneyShort = (cents: number) => {
  const v = Math.abs(cents) / 100;
  const s = v >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  return `${cents < 0 ? "−" : ""}${s}`;
};

/** Divide o total em parcelas; a diferença de centavos vai para a última. */
export function splitInstallments(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? total - base * (count - 1) : base));
}

export function isRec(x: unknown): x is Rec {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.updatedAt === "number" &&
    ["account", "category", "txn", "rule", "plan", "property", "vehicle", "valuation"].includes(r.t as string);
}
