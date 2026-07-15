const { getCurrentWindow, PhysicalPosition, LogicalSize } = window.__TAURI__.window;
const { invoke } = window.__TAURI__.core;

const appWindow = getCurrentWindow();
const pet = document.getElementById("pet");
const petImage = document.getElementById("petImage");
const menu = document.getElementById("menu");

const states = ["idle", "loading", "sleep", "error"];
const BASE_WINDOW = { width: 440, height: 360 };
let currentState = "idle";
let scale = Number(localStorage.getItem("kardii-scale") || "1");
let lastInteraction = Date.now();

function touch() {
  lastInteraction = Date.now();
}

function setState(state) {
  if (!states.includes(state)) return;
  currentState = state;
  petImage.src = `./assets/pet/${state}.webp`;
  petImage.alt = `Kardii ${state}`;
  menu.classList.add("hidden");
  touch();
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

pet.addEventListener("mousedown", async (event) => {
  if (event.button !== 0) return;
  // Let the second press reach the dblclick handler instead of starting a drag.
  if (event.detail > 1) return;
  touch();
  await appWindow.startDragging();
});

pet.addEventListener("dblclick", () => {
  const index = states.indexOf(currentState);
  setState(states[(index + 1) % states.length]);
});

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  menu.classList.toggle("hidden");
  touch();
});

document.addEventListener("click", async (event) => {
  const state = event.target?.dataset?.state;
  const action = event.target?.dataset?.action;

  if (state) setState(state);
  if (action === "smaller") await setScale(scale - 0.1);
  if (action === "larger") await setScale(scale + 0.1);
  if (action === "reset") await setScale(1);
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
