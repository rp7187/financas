import { useState } from "preact/hooks";
import type { Store } from "../app";
import { Reports } from "./reports";
import { Stats } from "./stats";

let remembered: "panel" | "reports" = "panel"; // volta para a mesma visão ao trocar de aba

/** Aba Análises: painel (visão geral do período) ou relatórios (consultas com filtros). */
export function Analyses({ store }: { store: Store }) {
  const [mode, setModeState] = useState(remembered);
  const setMode = (m: typeof mode) => { remembered = m; setModeState(m); window.scrollTo(0, 0); };
  const top = (
    <div class="seg wide an-switch" role="group" aria-label="Visão">
      <button type="button" class={mode === "panel" ? "on" : ""} aria-pressed={mode === "panel"} onClick={() => setMode("panel")}>Painel</button>
      <button type="button" class={mode === "reports" ? "on" : ""} aria-pressed={mode === "reports"} onClick={() => setMode("reports")}>Relatórios</button>
    </div>
  );
  return mode === "panel" ? <Stats store={store} top={top} /> : <Reports store={store} top={top} />;
}
