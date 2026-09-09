import { escapeHtml } from "../html";

// ---- context menu ----
export interface MenuItem {
  label?: string;
  action?: () => void;
  separator?: boolean;
  checked?: boolean; // renders a tick column; undefined = plain item
  keepOpen?: boolean; // toggles stay open so several can be flipped at once
  children?: MenuItem[];
}
function groupActions(items: MenuItem[]): MenuItem[] {
  const result = [...items];
  for (const label of ["Checkout", "Create", "Reset", "Copy"]) {
    const children = result.filter(i => i.label?.startsWith(label + " ") && !i.children);
    if (!children.length || (label === "Copy" && children.length < 2)) continue;
    const index = result.indexOf(children[0]);
    for (const item of children) result.splice(result.indexOf(item), 1);
    result.splice(index, 0, { label, children: children.map(i => ({ ...i, label: i.label!.slice(label.length + 1) })) });
  }
  return result.filter((i, n) => !i.separator || (n > 0 && n < result.length - 1 && !result[n - 1].separator));
}
export function showMenu(x: number, y: number, items: MenuItem[]) {
  closeMenu();
  if (!items.length) return;
  const menu = document.createElement("div");
  menu.id = "ctxmenu";
  fillMenu(menu, groupActions(items));
  document.body.appendChild(menu);
  positionMenu(menu, x, y);
  menu.querySelector<HTMLElement>(".ctxitem")?.focus({ preventScroll: true });
}
function positionMenu(menu: HTMLElement, x: number, y: number) {
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
}
function fillMenu(menu: HTMLElement, items: MenuItem[], closeParent?: () => void) {
  menu.className = "ctxmenu";
  menu.setAttribute("role", "menu");
  let child: HTMLElement | null = null;
  let owner: HTMLElement | null = null;
  const dismiss = () => {
    child?.remove(); child = null;
    owner?.setAttribute("aria-expanded", "false"); owner = null;
  };
  items.forEach((it) => {
    if (it.separator) {
      const sep = document.createElement("div");
      sep.className = "ctxsep";
      menu.appendChild(sep);
      return;
    }
    const row = document.createElement("div");
    row.className = "ctxitem";
    row.tabIndex = -1;
    row.setAttribute("role", it.checked === undefined ? "menuitem" : "menuitemcheckbox");
    if (it.checked !== undefined) row.setAttribute("aria-checked", String(it.checked));
    // a menu with any checkable item reserves a tick column so labels align
    if (items.some((m) => m.checked !== undefined)) {
      row.classList.add("checkable");
      row.innerHTML =
        `<span class="ctxtick">${it.checked ? "✓" : ""}</span>` +
        `<span>${escapeHtml(it.label ?? "")}</span>`;
    } else {
      const label = document.createElement("span");
      label.textContent = it.label ?? "";
      row.append(label);
    }
    if (it.children?.length) {
      row.setAttribute("aria-haspopup", "menu"); row.setAttribute("aria-expanded", "false");
      const arrow = document.createElement("span"); arrow.className = "ctxarrow"; arrow.textContent = "›"; row.append(arrow);
    }
    const open = () => {
      if (!it.children?.length || owner === row) return;
      dismiss(); owner = row; child = document.createElement("div");
      fillMenu(child, it.children, () => { dismiss(); row.focus(); });
      row.append(child); row.setAttribute("aria-expanded", "true");
      const bounds = row.getBoundingClientRect();
      const width = child.getBoundingClientRect().width;
      positionMenu(child, bounds.right + width > window.innerWidth - 4 ? bounds.left - width : bounds.right, bounds.top);
    };
    row.addEventListener("mouseenter", () => { if (owner !== row) dismiss(); open(); });
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      if (it.children?.length) { open(); return; }
      if (it.keepOpen) {
        e.stopPropagation();
        it.action?.();
        return;
      }
      closeMenu();
      it.action?.();
    });
    row.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); dismiss();
        const rows = [...menu.children].filter(el => el.classList.contains("ctxitem")) as HTMLElement[];
        rows[(rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length].focus();
      } else if (e.key === "ArrowRight" && it.children?.length) {
        e.preventDefault(); open(); child?.querySelector<HTMLElement>(".ctxitem")?.focus();
      } else if (e.key === "ArrowLeft" && closeParent) { e.preventDefault(); closeParent(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.click(); }
      else if (e.key === "Escape" || e.key === "Tab") closeMenu();
    });
    menu.appendChild(row);
  });
}
export function closeMenu() {
  document.getElementById("ctxmenu")?.remove();
}
