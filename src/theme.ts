/** Tema escolhido neste aparelho: "auto" segue o aparelho. Preferência local (não sincroniza). */
export type Theme = "auto" | "light" | "dark";
const KEY = "financas-tema";

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function applyTheme(t: Theme = getTheme()) {
  const root = document.documentElement;
  if (t === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  // cor da barra de status do navegador/app
  const dark = t === "dark" || (t === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#12141a" : "#f4f5f7"));
}

export function setTheme(t: Theme) {
  try {
    if (t === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch { /* sem armazenamento: vale só nesta sessão */ }
  applyTheme(t);
}
