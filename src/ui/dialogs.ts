import { escapeHtml } from "../html";

// ---- name prompt modal (returns entered text or null) ----
export function promptModal(
  title: string,
  placeholder = "",
  initial = ""
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      `<div class="modal">` +
      `<div class="modal-title">${escapeHtml(title)}</div>` +
      `<input class="modal-input" placeholder="${escapeHtml(placeholder)}" />` +
      `<div class="modal-btns">` +
      `<button class="modal-cancel">Cancel</button>` +
      `<button class="modal-ok">OK</button>` +
      `</div></div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector(".modal-input") as HTMLInputElement;
    input.value = initial;
    input.focus();
    input.select();
    const done = (val: string | null) => {
      overlay.remove();
      resolve(val);
    };
    overlay.querySelector(".modal-ok")?.addEventListener("click", () =>
      done(input.value.trim() || null)
    );
    overlay.querySelector(".modal-cancel")?.addEventListener("click", () =>
      done(null)
    );
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(input.value.trim() || null);
      if (e.key === "Escape") done(null);
    });
  });
}

export function errorModal(msg: string) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    `<div class="modal error-modal">` +
    `<div class="error-head"><span class="error-bang">!</span><span>Something went wrong</span></div>` +
    `<pre class="error-msg">${escapeHtml(msg)}</pre>` +
    `<div class="modal-btns"><button class="modal-ok">OK</button></div>` +
    `</div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  const ok = overlay.querySelector(".modal-ok") as HTMLButtonElement | null;
  ok?.addEventListener("click", close);
  ok?.focus();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
}

// Modal with several named choices (returns the picked key, or null).
// Used where "yes/no" would hide a real decision from the user.
export function choiceModal(
  title: string,
  body: string,
  choices: { key: string; label: string; danger?: boolean }[]
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      `<div class="modal choice-modal"><div class="modal-title">${escapeHtml(title)}</div>` +
      `<div class="modal-body">${escapeHtml(body)}</div>` +
      `<div class="modal-btns"><button class="modal-cancel">Cancel</button>` +
      choices
        .map(
          (c) =>
            `<button class="modal-ok${c.danger ? " danger" : ""}" data-key="${escapeHtml(c.key)}">` +
            `${escapeHtml(c.label)}</button>`
        )
        .join("") +
      `</div></div>`;
    document.body.appendChild(overlay);
    const done = (v: string | null) => {
      overlay.remove();
      resolve(v);
    };
    overlay.querySelectorAll<HTMLElement>(".modal-ok").forEach((b) =>
      b.addEventListener("click", () => done(b.dataset.key ?? null))
    );
    overlay.querySelector(".modal-cancel")?.addEventListener("click", () => done(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(null);
    });
  });
}

export function confirmModal(title: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      `<div class="modal"><div class="modal-title">${escapeHtml(title)}</div>` +
      `<div class="modal-btns"><button class="modal-cancel">Cancel</button>` +
      `<button class="modal-ok danger">Confirm</button></div></div>`;
    document.body.appendChild(overlay);
    const done = (v: boolean) => {
      overlay.remove();
      resolve(v);
    };
    overlay.querySelector(".modal-ok")?.addEventListener("click", () => done(true));
    overlay.querySelector(".modal-cancel")?.addEventListener("click", () => done(false));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(false);
    });
  });
}

