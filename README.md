# Finanças da família

Controle financeiro pessoal/familiar: **contas** (vários bancos), **receitas e despesas** por categoria,
**recorrentes** (todo mês, sem fim definido), **parcelados** (valor total ÷ parcelas), **transferências**
entre contas, **imóveis** (custos associados, opcional), pago/pendente e **análises** com previsão dos próximos meses.

- PWA: roda no Safari do iPhone e do Mac e pode ser instalado (tela de início / Dock), sem loja de apps.
- Funciona offline; dados no aparelho (IndexedDB). Sincronização em família (Mac + iPhones) criptografada no aparelho:
  Ajustes → Família e sincronização (ver `CLAUDE.md`). Publicado em https://rp7187.github.io/financas/
- Leve: ~26 KB (gzip) de JS + CSS; única dependência é o Preact.

## Uso

- **Mês**: navegue mês a mês; toque no círculo para marcar como pago/recebido; toque no lançamento para editar.
  Recorrentes aparecem como "previsto" até serem confirmados; dá para alterar só um mês ou "este e os próximos".
- **Contas**: saldo de cada conta (saldo inicial + o que já foi pago/recebido) e transferências.
- **Estatísticas**: despesas/receitas por categoria (vs mês anterior), receitas × despesas em 12 meses,
  saldo no fim de cada mês com previsão de 6 meses, e o que já está comprometido nos próximos meses.
- **Ajustes**: imóveis (cadastro e custo dos últimos 12 meses), categorias (criar/editar/arquivar), backup.

## Desenvolvimento

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # dist/
npm run preview   # http://localhost:4173
```
