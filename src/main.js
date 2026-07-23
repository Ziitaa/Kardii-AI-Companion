const {
  getCurrentWindow,
  getAllWindows,
  PhysicalPosition,
  LogicalPosition,
  LogicalSize,
} = window.__TAURI__.window;
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const appWindow = getCurrentWindow();
const pet = document.getElementById("pet");
const petImage = document.getElementById("petImage");
const menu = document.getElementById("menu");

const states = ["idle", "thinking", "talking", "happy", "loading", "sleep", "error"];
const BASE_WINDOW = { width: 440, height: 360 };
const TRANSIENT_STATE_DURATIONS = { happy: 1650 };
let currentState = "idle";
let scale = Number(localStorage.getItem("kardii-scale") || "1");
let lastInteraction = Date.now();
let clickTimer;
let stateReturnTimer;
let dragStart = null;
let didDrag = false;

function touch() {
  lastInteraction = Date.now();
}

function setState(state) {
  if (!states.includes(state)) return;
  clearTimeout(stateReturnTimer);
  currentState = state;
  petImage.src = `./assets/pet/${state}.webp`;
  petImage.alt = `Kardii ${state}`;
  menu.classList.add("hidden");
  touch();

  const duration = TRANSIENT_STATE_DURATIONS[state];
  if (duration) {
    stateReturnTimer = setTimeout(() => setState("idle"), duration);
  }
}

async function setScale(nextScale) {
  scale = Math.max(0.6, Math.min(2.4, Number(nextScale.toFixed(2))));
  document.documentElement.style.setProperty("--pet-scale", scale);
  localStorage.setItem("kardii-scale", String(scale));
  await appWindow.setSize(new LogicalSize(
    Math.max(280, Math.round(BASE_WINDOW.width * scale)),
    Math.max(230, Math.round(BASE_WINDOW.height * scale)),
  ));
}

async function restorePosition() {
  try {
    const saved = JSON.parse(localStorage.getItem("kardii-position") || "null");
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      await appWindow.setPosition(new PhysicalPosition(saved.x, saved.y));
    }
  } catch {
    localStorage.removeItem("kardii-position");
  }
}

pet.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  if (event.detail > 1) return;
  touch();
  dragStart = { x: event.screenX, y: event.screenY };
  didDrag = false;
});

window.addEventListener("mousemove", (event) => {
  if (!dragStart || (event.buttons & 1) === 0) return;
  const distance = Math.hypot(
    event.screenX - dragStart.x,
    event.screenY - dragStart.y,
  );
  if (distance < 12) return;

  dragStart = null;
  didDrag = true;
  clearTimeout(clickTimer);
  void appWindow.startDragging();
});

window.addEventListener("mouseup", (event) => {
  if (event.button !== 0 || !dragStart) return;
  const distance = Math.hypot(
    event.screenX - dragStart.x,
    event.screenY - dragStart.y,
  );
  dragStart = null;

  if (!didDrag && distance < 12) {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => void toggleChat(), 240);
  }
});

pet.addEventListener("dblclick", () => {
  clearTimeout(clickTimer);
  const index = states.indexOf(currentState);
  setState(states[(index + 1) % states.length]);
});

async function toggleChat() {
  const chatWindow = (await getAllWindows()).find((window) => window.label === "chat");
  if (!chatWindow) return;

  if (await chatWindow.isVisible()) {
    await chatWindow.hide();
    return;
  }

  const petPosition = await appWindow.outerPosition();
  const petSize = await appWindow.outerSize();
  const chatSize = await chatWindow.outerSize();
  const gap = 12;
  const leftX = petPosition.x - chatSize.width - gap;
  const x = leftX >= 0 ? leftX : petPosition.x + petSize.width + gap;
  const y = Math.max(16, petPosition.y + petSize.height - chatSize.height - 18);

  await chatWindow.setPosition(new PhysicalPosition(x, y));
  await chatWindow.show();
  await chatWindow.setFocus();
}

async function openWorkbench() {
  const workbenchWindow = (await getAllWindows()).find((window) => window.label === "workbench");
  if (!workbenchWindow) return;
  await workbenchWindow.show();
  await workbenchWindow.unminimize();
  await workbenchWindow.setFocus();
}

async function keepWindowOnScreen() {
  const margin = 8;
  const left = Number.isFinite(window.screen.availLeft) ? window.screen.availLeft : 0;
  const top = Number.isFinite(window.screen.availTop) ? window.screen.availTop : 0;
  const right = left + window.screen.availWidth;
  const bottom = top + window.screen.availHeight;
  const maxX = Math.max(left + margin, right - window.outerWidth - margin);
  const maxY = Math.max(top + margin, bottom - window.outerHeight - margin);
  const x = Math.min(Math.max(window.screenX, left + margin), maxX);
  const y = Math.min(Math.max(window.screenY, top + margin), maxY);

  if (Math.abs(x - window.screenX) > 1 || Math.abs(y - window.screenY) > 1) {
    await appWindow.setPosition(new LogicalPosition(Math.round(x), Math.round(y)));
  }
}

document.addEventListener("contextmenu", async (event) => {
  event.preventDefault();
  const shouldOpen = menu.classList.contains("hidden");
  menu.classList.toggle("hidden", !shouldOpen);
  if (shouldOpen) await keepWindowOnScreen();
  touch();
});

document.addEventListener("click", async (event) => {
  const state = event.target?.dataset?.state;
  const action = event.target?.dataset?.action;

  if (state) setState(state);
  if (action === "smaller") await setScale(scale - 0.1);
  if (action === "larger") await setScale(scale + 0.1);
  if (action === "reset") await setScale(1);
  if (action === "workbench") await openWorkbench();
  if (action === "chat") await toggleChat();
  if (action === "hide") await appWindow.hide();
  if (action === "quit") await invoke("quit_app");

  if (!menu.contains(event.target)) menu.classList.add("hidden");
});

window.addEventListener("wheel", (event) => {
  event.preventDefault();
  void setScale(scale + (event.deltaY < 0 ? 0.1 : -0.1));
  touch();
}, { passive: false });

appWindow.onMoved(({ payload }) => {
  localStorage.setItem("kardii-position", JSON.stringify(payload));
});

listen("kardii-state", ({ payload }) => setState(payload));

states.forEach((state) => {
  const image = new Image();
  image.src = `./assets/pet/${state}.webp`;
});

["mousemove", "keydown", "touchstart"].forEach((name) => {
  window.addEventListener(name, touch, { passive: true });
});

setInterval(() => {
  if (Date.now() - lastInteraction > 180_000 && currentState !== "sleep") {
    setState("sleep");
  }
}, 10_000);

void setScale(scale);
restorePosition();
