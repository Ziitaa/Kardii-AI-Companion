(() => {
  let activeRequest = null;
  const queue = [];
  let elements = null;

  function createElements() {
    if (elements) return elements;
    const overlay = document.createElement("section");
    overlay.className = "kardii-dialog-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "presentation");
    overlay.innerHTML = `
      <div class="kardii-dialog-card" role="alertdialog" aria-modal="true" aria-labelledby="kardiiDialogTitle" aria-describedby="kardiiDialogMessage">
        <div class="kardii-dialog-heading">
          <span class="kardii-dialog-mark" aria-hidden="true">K</span>
          <div class="kardii-dialog-copy">
            <span class="kardii-dialog-kicker">KARDII CONFIRM</span>
            <strong id="kardiiDialogTitle" class="kardii-dialog-title"></strong>
          </div>
        </div>
        <p id="kardiiDialogMessage" class="kardii-dialog-message"></p>
        <div class="kardii-dialog-actions">
          <button class="kardii-dialog-cancel" type="button"></button>
          <button class="kardii-dialog-confirm" type="button"></button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const card = overlay.querySelector(".kardii-dialog-card");
    const title = overlay.querySelector(".kardii-dialog-title");
    const message = overlay.querySelector(".kardii-dialog-message");
    const cancelButton = overlay.querySelector(".kardii-dialog-cancel");
    const confirmButton = overlay.querySelector(".kardii-dialog-confirm");

    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) settle(false);
    });
    cancelButton.addEventListener("click", () => settle(false));
    confirmButton.addEventListener("click", () => settle(true));
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        settle(false);
      } else if (event.key === "Enter" && event.target === cancelButton) {
        event.preventDefault();
        settle(false);
      }
    });
    elements = { overlay, card, title, message, cancelButton, confirmButton };
    return elements;
  }

  function settle(confirmed) {
    if (!activeRequest) return;
    const request = activeRequest;
    activeRequest = null;
    const dialog = createElements();
    dialog.overlay.hidden = true;
    request.resolve(Boolean(confirmed));
    if (request.returnFocus?.isConnected) request.returnFocus.focus();
    showNext();
  }

  function showNext() {
    if (activeRequest || !queue.length) return;
    activeRequest = queue.shift();
    const dialog = createElements();
    const options = activeRequest.options;
    dialog.card.dataset.tone = options.tone;
    dialog.title.textContent = options.title;
    dialog.message.textContent = options.message;
    dialog.cancelButton.textContent = options.cancelLabel;
    dialog.confirmButton.textContent = options.confirmLabel;
    dialog.overlay.hidden = false;
    requestAnimationFrame(() => dialog.cancelButton.focus());
  }

  window.kardiiConfirm = (value) => {
    const input = typeof value === "string" ? { message: value } : (value || {});
    const options = {
      title: String(input.title || "请确认这一步"),
      message: String(input.message || "确认继续吗？"),
      confirmLabel: String(input.confirmLabel || "确认"),
      cancelLabel: String(input.cancelLabel || "取消"),
      tone: input.tone === "danger" ? "danger" : "primary",
    };
    return new Promise((resolve) => {
      queue.push({ options, resolve, returnFocus: document.activeElement });
      showNext();
    });
  };
})();
