const { getCurrentWindow, PhysicalPosition } = window.__TAURI__.window;
const { invoke } = window.__TAURI__.core;

const appWindow = getCurrentWindow();
const pet = document.getElementById("pet");
const petImage = document.getElementById("petImage");
const menu = document.getElementById("menu");

const states = ["idle", "loading", "sleep", "error"];
let currentState = "idle";
let scale = Number(localStorage.getItem("kardii-scale") || "1");
let lastInteraction = Date.now();
let dragging = false;

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

function setScale(nextScale) {
  scale = Math.max(0.6, Math.min(1.35, Number(nextScale.toFixed(2))));
  document.documentElement.style.setProperty("--pet-scale", scale);
  localStorage.setItem("kardii-scale", String(scale));
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
  dragging = true;
  touch();
  await appWindow.startDragging();
});

window.addEventListener("mouseup", () => {
  dragging = false;
});

pet.addEventListener("dblclick", () => {
  if (dragging) return;
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
  if (action === "smaller") setScale(scale - 0.1);
  if (action === "larger") setScale(scale + 0.1);
  if (action === "reset") setScale(1);
  if (action === "hide") await appWindow.hide();
  if (action === "quit") await invoke("quit_app");

  if (!menu.contains(event.target)) menu.classList.add("hidden");
});

window.addEventListener("wheel", (event) => {
  event.preventDefault();
  setScale(scale + (event.deltaY < 0 ? 0.05 : -0.05));
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

setScale(scale);
restorePosition();
