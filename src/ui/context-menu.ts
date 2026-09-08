import { escapeHtml } from "../html";

// ---- context menu ----
export interface MenuItem {
  label?: string;
  action?: () => void;
  separator?: boolean;
  checked?: boolean; // renders a tick column; undefined = plain item
  keepOpen?: boolean; // toggles stay open so several can be flipped at once
}
export function showMenu(x: number, y: number, items: MenuItem[]) {
  closeMenu();
  if (!items.length) return;
  const menu = document.createElement("div");
  menu.id = "ctxmenu";
  items.forEach((it) => {
    if (it.separator) {
      const sep = document.createElement("div");
      sep.className = "ctxsep";
      menu.appendChild(sep);
      return;
    }
    const row = document.createElement("div");
    row.className = "ctxitem";
    // a menu with any checkable item reserves a tick column so labels align
    if (items.some((m) => m.checked !== undefined)) {
      row.classList.add("checkable");
      row.innerHTML =
        `<span class="ctxtick">${it.checked ? "✓" : ""}</span>` +
        `<span>${escapeHtml(it.label ?? "")}</span>`;
    } else {
      row.textContent = it.label ?? "";
    }
    row.addEventListener("click", (e) => {
      if (it.keepOpen) {
        e.stopPropagation();
        it.action?.();
        return;
      }
      closeMenu();
      it.action?.();
    });
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  // keep on-screen
  const rect = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 4);
  const py = Math.min(y, window.innerHeight - rect.height - 4);
  menu.style.left = `${px}px`;
  menu.style.top = `${Math.max(4, py)}px`;
}
export function closeMenu() {
  document.getElementById("ctxmenu")?.remove();
}

