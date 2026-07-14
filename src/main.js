const { getCurrentWindow } = window.__TAURI__.window;
const { invoke } = window.__TAURI__.core;

const appWindow = getCurrentWindow();
const pet = document.getElementById("pet");
const canvas = document.getElementById("petCanvas");
const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
const menu = document.getElementById("menu");
const states = ["loading", "sleep", "error"];
const sources = {};
let current = 0;
let scale = Number(localStorage.getItem("kardii-scale") || "1");
let lastAction = Date.now();
let startedAt = performance.now();

function removeConnectedWhiteBackground(image) {
  const temp = document.createElement("canvas");
  temp.width = image.naturalWidth;
  temp.height = image.naturalHeight;
  const tctx = temp.getContext("2d", { willReadFrequently: true });
  tctx.drawImage(image, 0, 0);
  const frame = tctx.getImageData(0, 0, temp.width, temp.height);
  const data = frame.data;
  const width = temp.width;
  const height = temp.height;
  const seen = new Uint8Array(width * height);
  const queue = [];
  const isBackground = (index) => {
    const p = index * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    return data[p + 3] > 0 && r >= 248 && g >= 248 && b >= 248;
  };
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (seen[index] || !isBackground(index)) return;
    seen[index] = 1;
    queue.push(index);
  };
  for (let x = 0; x < width; x += 1) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += 1) { push(0, y); push(width - 1, y); }
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head];
    const x = index % width;
    const y = Math.floor(index / width);
    data[index * 4 + 3] = 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  tctx.putImageData(frame, 0, 0);
  return temp;
}

async function loadState(state) {
  const image = new Image();
  image.src = `./${state}.png`;
  await image.decode();
  sources[state] = removeConnectedWhiteBackground(image);
}

function setState(state) {
  current = states.indexOf(state);
  startedAt = performance.now();
  menu.classList.add("hidden");
  lastAction = Date.now();
}

function applyScale() {
  localStorage.setItem("kardii-scale", String(scale));
}

function draw(time) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const state = states[current];
  const source = sources[state];
  if (source) {
    const elapsed = (time - startedAt) / 1000;
    let xScale = scale;
    let yScale = scale;
    let rotation = 0;
    let offsetY = 0;
    if (state === "loading") {
      offsetY = -4 * Math.sin(elapsed * Math.PI * 1.5);
      rotation = 0.008 * Math.sin(elapsed * Math.PI * 1.5);
    } else if (state === "sleep") {
      const breath = (Math.sin(elapsed * Math.PI) + 1) / 2;
      xScale *= 1 + breath * 0.014;
      yScale *= 1 - breath * 0.009;
      offsetY = breath * 2;
    } else {
      rotation = 0.022 * Math.sin(elapsed * Math.PI * 3.2);
    }
    const fit = Math.min(380 / source.width, 300 / source.height);
    const width = source.width * fit * xScale;
    const height = source.height * fit * yScale;
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2 + offsetY);
    ctx.rotate(rotation);
    ctx.drawImage(source, -width / 2, -height / 2, width, height);
    ctx.restore();
  }
  requestAnimationFrame(draw);
}

pet.addEventListener("mousedown", async (event) => {
  if (event.button === 0) {
    lastAction = Date.now();
    await appWindow.startDragging();
  }
});

pet.addEventListener("dblclick", () => setState(states[(current + 1) % states.length]));

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  menu.classList.toggle("hidden");
  lastAction = Date.now();
});

document.addEventListener("click", (event) => {
  const action = event.target?.dataset?.action;
  if (states.includes(action)) setState(action);
  if (action === "smaller") { scale = Math.max(.55, +(scale - .1).toFixed(2)); applyScale(); }
  if (action === "larger") { scale = Math.min(1.45, +(scale + .1).toFixed(2)); applyScale(); }
  if (action === "quit") invoke("quit_app");
  if (!menu.contains(event.target) && event.target !== pet) menu.classList.add("hidden");
});

window.addEventListener("wheel", (event) => {
  scale = Math.max(.55, Math.min(1.45, +(scale + (event.deltaY < 0 ? .05 : -.05)).toFixed(2)));
  applyScale();
  lastAction = Date.now();
});

["mousemove", "mousedown", "keydown"].forEach((name) => window.addEventListener(name, () => { lastAction = Date.now(); }));
setInterval(() => { if (Date.now() - lastAction > 180000 && states[current] !== "sleep") setState("sleep"); }, 10000);

Promise.all(states.map(loadState)).then(() => requestAnimationFrame(draw));
