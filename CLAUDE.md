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
- `plan` (parcelado) grava uma `txn` por parcela (`planId`, `installment`).
- Transferência = `txn` com `type: "transfer"`, `accountId` → `toAccountId`; não entra em receitas/despesas.

## Fase 2 (planejada): família + sincronização

Supabase (plano gratuito) como depósito de registros criptografados no aparelho (AES-GCM, chave da
família compartilhada por link de convite, no fragmento `#` da URL). Mescla por registro: vale o maior
`updatedAt`. Login por e-mail (código). O servidor nunca vê dados em claro.

## Publicação

Push na `main` → GitHub Actions publica no GitHub Pages.
