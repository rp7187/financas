import type { ComponentChildren } from "preact";
import type { Store } from "../app";
import { Icon } from "./icons";

/** Cabeçalho das telas: título, ações e a engrenagem de Ajustes. */
export function PageHead({ store, title, children }: { store: Store; title: string; children?: ComponentChildren }) {
  return (
    <header class="page-head">
      <h1>{title}</h1>
      <div class="head-actions">
        {children}
        <button type="button" class="icon-btn" aria-label="Ajustes" onClick={() => store.go("settings")}><Icon name="gear" /></button>
      </div>
    </header>
  );
}
