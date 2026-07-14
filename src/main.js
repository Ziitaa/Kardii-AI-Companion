const { getCurrentWindow } = window.__TAURI__.window;
const { invoke } = window.__TAURI__.core;

const appWindow = getCurrentWindow();
const pet = document.getElementById("pet");
const image = document.getElementById("petImage");
const menu = document.getElementById("menu");
const states = ["loading", "sleep", "error"];
let current = 0;
let scale = Number(localStorage.getItem("kardii-scale") || "1");
let lastAction = Date.now();

function setState(state) {
  current = states.indexOf(state);
  image.src = `./${state}.svg?${Date.now()}`;
  menu.classList.add("hidden");
  lastAction = Date.now();
}

function applyScale() {
  image.style.transform = `scale(${scale})`;
  localStorage.setItem("kardii-scale", String(scale));
}

pet.addEventListener("mousedown", async (event) => {
  if (event.button === 0) {
    lastAction = Date.now();
    await appWindow.startDragging();
  }
});

pet.addEventListener("dblclick", () => {
  current = (current + 1) % states.length;
  setState(states[current]);
});

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  menu.classList.toggle("hidden");
  lastAction = Date.now();
});

document.addEventListener("click", (event) => {
  const action = event.target?.dataset?.action;
  if (states.includes(action)) setState(action);
  if (action === "smaller") {
    scale = Math.max(.55, +(scale - .1).toFixed(2));
    applyScale();
  }
  if (action === "larger") {
    scale = Math.min(1.45, +(scale + .1).toFixed(2));
    applyScale();
  }
  if (action === "quit") invoke("quit_app");
  if (!menu.contains(event.target) && event.target !== pet) menu.classList.add("hidden");
});

window.addEventListener("wheel", (event) => {
  scale = Math.max(.55, Math.min(1.45, +(scale + (event.deltaY < 0 ? .05 : -.05)).toFixed(2)));
  applyScale();
  lastAction = Date.now();
});

["mousemove", "mousedown", "keydown"].forEach((name) =>
  window.addEventListener(name, () => { lastAction = Date.now(); })
);

setInterval(() => {
  if (Date.now() - lastAction > 180000 && current !== 1) setState("sleep");
}, 10000);

applyScale();
