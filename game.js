/* ============================================================
   CONFIG
============================================================ */
const levels = [
  { cols: 8, rows: 8, levelTime: 60 },
  { cols: 10, rows: 10, levelTime: 70 },
  { cols: 10, rows: 12, levelTime: 80 },
  { cols: 12, rows: 12, levelTime: 95 },
  { cols: 15, rows: 15, levelTime: 110 }
];

// SLOWER DRYING TIMES
const EDGE_DRY_TIME  = 20;
const INNER_DRY_TIME = 30;

// How many trowel passes needed to fully finish a tile
const PASSES_TO_FINISH = 5;

/* ============================================================
   GLOBAL GAME STATE
============================================================ */
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

let currentLevelIndex = 0;
let tiles = [];
let cols = 8;
let rows = 8;
let tileSize = 30;

let trowelX = 0;
let trowelY = 0;

let levelTime = 60;
let timeRemaining = 60;
let startTimestamp = null;
let isLevelRunning = false;

let lastFrameTime = null;
let bestScore = 0;

let touchStartX = null;
let touchStartY = null;

/* ============================================================
   TILE MODEL
============================================================ */
function createTile(isEdge) {
  return {
    passes: 0,
    lastWorkedTime: 0,
    locked: false,
    finished: false,
    dryTime: isEdge ? EDGE_DRY_TIME : INNER_DRY_TIME
  };
}

function isEdgeTile(x, y, c, r) {
  return x === 0 || y === 0 || x === c - 1 || y === r - 1;
}

/* ============================================================
   LEVEL SETUP
============================================================ */
function setupLevel(levelIndex) {
  const L = levels[levelIndex];
  cols = L.cols;
  rows = L.rows;
  levelTime = L.levelTime;
  timeRemaining = L.levelTime;
  startTimestamp = null;
  lastFrameTime = null;
  isLevelRunning = true;

  resizeCanvas();

  // Create grid
  tiles = [];
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) {
      row.push(createTile(isEdgeTile(x, y, cols, rows)));
    }
    tiles.push(row);
  }

  // Trowel starts near center
  trowelX = Math.floor(cols / 2);
  trowelY = Math.floor(rows / 2);

  // First tile gets one pass
  tiles[trowelY][trowelX].passes = 1;
  tiles[trowelY][trowelX].lastWorkedTime = 0;

  hideMessage();
  updateHUD();
  requestAnimationFrame(gameLoop);
}

/* ============================================================
   CANVAS RESIZE
============================================================ */
function resizeCanvas() {
  const containerWidth =
    document.getElementById("game-container").clientWidth - 16;

  const maxCanvasSize = Math.min(containerWidth, window.innerHeight * 0.6);

  const largestSide = Math.max(cols, rows);
  tileSize = Math.floor(maxCanvasSize / largestSide);
  if (tileSize < 18) tileSize = 18;

  canvas.width = cols * tileSize;
  canvas.height = rows * tileSize;
}

window.addEventListener("resize", () => {
  resizeCanvas();
  if (isLevelRunning) drawGame(0);
});

/* ============================================================
   DRAWING
============================================================ */
function drawGame(gameTime) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw tiles
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const t = tiles[y][x];
      let color;

      if (t.locked) {
        color = t.finished ? "#555555" : "#f5f5f5";
      } else {
        const baseGray = 220 - t.passes * 25;
        const elapsed = Math.max(0, gameTime - t.lastWorkedTime);
        const dryness = Math.min(1, elapsed / t.dryTime);
        const g = Math.round(baseGray + (255 - baseGray) * dryness);
        color = `rgb(${g},${g},${g})`;
      }

      ctx.fillStyle = color;
      ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);

      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
    }
  }

  // Draw trowel (yellow square)
  const pad = tileSize * 0.15;
  const tx = trowelX * tileSize + pad;
  const ty = trowelY * tileSize + pad;
  const size = tileSize - pad * 2;

  ctx.fillStyle = "#ffeb99";
  ctx.fillRect(tx, ty, size, size);

  ctx.strokeStyle = "#d1a100";
  ctx.lineWidth = 2;
  ctx.strokeRect(tx, ty, size, size);
}

/* ============================================================
   GAME LOOP
============================================================ */
function gameLoop(timestamp) {
  if (!isLevelRunning) return;

  if (!startTimestamp) {
    startTimestamp = timestamp;
    lastFrameTime = timestamp;
  }

  const elapsed = (timestamp - startTimestamp) / 1000;
  timeRemaining = Math.max(0, levelTime - elapsed);

  updateTilesDrying(elapsed);
  updateHUD();
  drawGame(elapsed);

  if (timeRemaining <= 0 || checkAllLocked()) {
    finishLevel();
    return;
  }

  requestAnimationFrame(gameLoop);
}

/* ============================================================
   DRYING LOGIC
============================================================ */
function updateTilesDrying(gameTime) {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const t = tiles[y][x];

      if (t.finished) {
        t.locked = true;
        continue;
      }

      if (t.locked) continue;

      const elapsed = gameTime - t.lastWorkedTime;

      if (elapsed >= t.dryTime || timeRemaining <= 0) {
        t.locked = true;
        t.finished = t.passes >= PASSES_TO_FINISH;
      }
    }
  }
}

function checkAllLocked() {
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (!tiles[y][x].locked) return false;
  return true;
}

/* ============================================================
   HUD + SCORING
============================================================ */
function updateHUD() {
  document.getElementById("levelDisplay").textContent = currentLevelIndex + 1;
  document.getElementById("timeDisplay").textContent = Math.ceil(timeRemaining);

  let perfect = 0;
  let score = 0;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const t = tiles[y][x];
      if (t.finished) perfect++;
      score += t.passes;
    }
  }

  document.getElementById("perfectDisplay").textContent = perfect;
  document.getElementById("scoreDisplay").textContent = score;

  const savedBest = localStorage.getItem("concreteGameBestScore");
  if (savedBest !== null) bestScore = parseInt(savedBest);

  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem("concreteGameBestScore", score);
  }

  document.getElementById("bestDisplay").textContent = bestScore;
}

/* ============================================================
   FINISH LEVEL
============================================================ */
function finishLevel() {
  isLevelRunning = false;

  let perfect = 0;
  let partial = 0;
  let total = cols * rows;
  let totalPasses = 0;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const t = tiles[y][x];
      totalPasses += t.passes;
      if (t.finished) perfect++;
      else if (t.passes > 0) partial++;
    }
  }

  const pct = Math.round((perfect / total) * 100);

  const title =
    pct === 100 ? "Perfect slab!" :
    pct >= 70 ? "Nice finish!" :
    pct >= 40 ? "Decent work!" :
    "It set up on you 😅";

  document.getElementById("message-title").textContent = title;
  document.getElementById("message-body").textContent =
    `Level ${currentLevelIndex + 1} complete.`;
  document.getElementById("message-details").textContent =
    `Perfect: ${perfect}/${total} (${pct}%) · Partial: ${partial} · Passes: ${totalPasses}`;

  showMessage();

  document.getElementById("nextLevelBtn").textContent =
    currentLevelIndex < levels.length - 1
      ? "Next level ▶"
      : "Play again 🔁";
}

/* ============================================================
   MESSAGE OVERLAY
============================================================ */
function showMessage() {
  document.getElementById("message-overlay").style.display = "flex";
}

function hideMessage() {
  document.getElementById("message-overlay").style.display = "none";
}

/* ============================================================
   MOVEMENT + INPUT
============================================================ */
function moveTrowel(dx, dy) {
  if (!isLevelRunning) return;

  const nx = trowelX + dx;
  const ny = trowelY + dy;

  if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) return;

  trowelX = nx;
  trowelY = ny;

  const t = tiles[ny][nx];

  if (!t.locked && !t.finished) {
    t.passes++;
    if (t.passes >= PASSES_TO_FINISH) {
      t.finished = true;
      t.locked = true;
    }
    t.lastWorkedTime = (performance.now() - startTimestamp) / 1000;
  }
}

// Keyboard controls
window.addEventListener("keydown", e => {
  if (!isLevelRunning) return;
  const k = e.key.toLowerCase();

  if (k === "arrowup" || k === "w") moveTrowel(0, -1);
  else if (k === "arrowdown" || k === "s") moveTrowel(0, 1);
  else if (k === "arrowleft" || k === "a") moveTrowel(-1, 0);
  else if (k === "arrowright" || k === "d") moveTrowel(1, 0);
});

// Mobile swipe controls
canvas.addEventListener("touchstart", e => {
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
}, { passive: true });

canvas.addEventListener("touchend", e => {
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;

  const ax = Math.abs(dx);
  const ay = Math.abs(dy);

  if (Math.max(ax, ay) < 20) return;

  if (ax > ay) moveTrowel(dx > 0 ? 1 : -1, 0);
  else moveTrowel(0, dy > 0 ? 1 : -1);
});

/* ============================================================
   BUTTONS
============================================================ */
document.getElementById("restartButton").onclick = () =>
  setupLevel(currentLevelIndex);

document.getElementById("helpButton").onclick = () => {
  alert(
    "Goal:\n" +
    "- Use your trowel to finish concrete before it dries.\n" +
    "- Tiles need 5 passes to fully finish.\n" +
    "- Finished tiles NEVER dry.\n\n" +
    "Controls:\n" +
    "- Arrow keys / WASD\n" +
    "- Swipe on mobile"
  );
};

document.getElementById("nextLevelBtn").onclick = () => {
  hideMessage();
  currentLevelIndex =
    currentLevelIndex < levels.length - 1
      ? currentLevelIndex + 1
      : 0;
  setupLevel(currentLevelIndex);
};

/* ============================================================
   INIT
============================================================ */
function init() {
  const saved = localStorage.getItem("concreteGameBestScore");
  if (saved) bestScore = parseInt(saved);

  document.getElementById("bestDisplay").textContent = bestScore;
  setupLevel(currentLevelIndex);
}

init();
