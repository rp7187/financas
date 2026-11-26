# Finanças da família — regras do projeto

## Dados nos aparelhos: compatibilidade obrigatória

Os dados existem nos aparelhos (IndexedDB) e, na fase 2, também na nuvem (criptografados).
Nenhuma versão nova pode perder ou tornar ilegível o que já foi gravado.

- Nunca renomear o banco (`financas`), os stores (`records`, `meta`) nem a `keyPath` (`id`) em `src/db.ts`.
- Nunca remover nem mudar o significado de campos existentes dos registros (`src/model.ts`).
  Campos novos só como **opcionais**, com leitura tolerante. Tipos novos de registro (`t`) podem ser
  adicionados; `isRec` precisa continuar aceitando os antigos (o import de backups depende dele).
- Toda gravação passa por `store.put`/`store.del` (carimbam `updatedAt`). Excluir = marca `deleted`
  (nunca apagar fisicamente): a sincronização depende disso.
- IDs das categorias/conta padrão são fixos (`defaults.ts`) para não duplicar ao mesclar aparelhos.
- Mudança de estrutura = subir a versão em `indexedDB.open(DB_NAME, N)` e migrar em `onupgradeneeded`
  sem apagar registros.
- Antes de publicar mudança que toque em `db.ts`/`model.ts`/`engine.ts`: gravar dados com a versão
  publicada e abrir a versão nova no mesmo endereço/perfil, conferindo saldos e registros.

## Modelo (resumo)

- Valores em centavos (inteiros); datas `AAAA-MM-DD`, meses `AAAA-MM`.
- `rule` (recorrente mensal) não grava um registro por mês: os meses são calculados (`engine.ts`).
  Um `txn` com `ruleId` + `ruleMonth` confirma/ajusta aquele mês; excluído = mês pulado.
- `plan` (parcelado) grava uma `txn` por parcela (`planId`, `installment`). `every` (opcional) = meses entre
  parcelas (ausente = mensal); `dates` (opcional) = datas ajustadas à mão (ex.: reforços de obra).
- Transferência = `txn` com `type: "transfer"`, `accountId` → `toAccountId`; não entra em receitas/despesas.
- Cartão de crédito = conta `kind: "credit"`; fatura calculada por ciclo (`engine.ts`), paga por transferência com `billFor`.
  Saldo em caixa: compra no cartão conta como despesa no mês da compra, mas só sai do saldo das contas no pagamento da fatura.
- Imóvel (`property`) e veículo (`vehicle`): cadastros para somar custos; despesa/recorrente/parcelado
  guardam `propertyId` / `vehicleId` (opcionais). Versões antigas ignoram `t: "vehicle"` (o `isRec` filtra).
- Investimento = conta `kind: "investment"` ou `"savings"`: fica fora do "disponível" (saldo total, previsto,
  simulação); aporte/resgate = transferência. Saldo vem do `valuation` (um por conta por mês, id fixo
  `val:<conta>:<mês>`) + movimentos depois dele; rendimento = saldo − saldo anterior − aportes líquidos.

## Fase 2: família + sincronização (`src/sync.ts`, `supabase/schema.sql`)

Supabase (plano gratuito) como depósito de registros criptografados no aparelho (AES-GCM 256, iv aleatório,
id como dado autenticado). A chave da família só existe nos aparelhos (meta `sync` no IndexedDB) e no link de
convite (`#familia=<id>.<chave>`, no fragmento da URL). Sem login: o aparelho manda uma "prova" derivada da
chave e o servidor guarda só o SHA-256 dela; as tabelas não são acessíveis pela chave pública, só as funções
`create_family` / `push_records` / `pull_records` / `delete_family`.

- Mescla por registro: vale o maior `updatedAt` (no servidor e no aparelho). Alterações locais ficam em
  meta `syncDirty` até o servidor confirmar. `rev` (sequência do servidor) permite buscar só o que mudou;
  1×/dia o aparelho refaz a busca completa.
- Ao entrar numa família, os dados da família prevalecem; o que só existe no aparelho é acrescentado.
- Mudança no schema do servidor: editar `supabase/schema.sql` mantendo-o reexecutável e avisar o usuário
  para rodá-lo no SQL Editor (não há acesso de administrador ao banco pelo app).

## Publicação

Push na `main` → GitHub Actions publica no GitHub Pages.
