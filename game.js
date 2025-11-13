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

// How many trowel passes needed to fully finish a tile (stage 5)
const PASSES_TO_FINISH = 5;

/* ============================================================
   GLOBAL GAME STATE
============================================================ */
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Load the trowel image
const trowelImg = new Image();
trowelImg.src = "trowel.png";
let trowelLoaded = false;

trowelImg.onload = () => {
  trowelLoaded = true;
};

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

let totalRunScore = 0; // score for current run
let touchStartX = null;
let touchStartY = null;

/* Swipe + hold */
let currentDirection = null;
let holdInterval = null;
const MOVE_INTERVAL = 150;

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

  // Build tiles
  tiles = [];
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) {
      row.push(createTile(isEdgeTile(x, y, cols, rows)));
    }
    tiles.push(row);
  }

  // Start in the center
  trowelX = Math.floor(cols / 2);
  trowelY = Math.floor(rows / 2);

  tiles[trowelY][trowelX].passes = 1;

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

  // Draw each tile
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

  // Draw trowel
  if (trowelLoaded) {
    const pad = tileSize * 0.1;
    const size = tileSize - pad * 2;

    ctx.drawImage(
      trowelImg,
      trowelX * tileSize + pad,
      trowelY * tileSize + pad,
      size,
      size
    );
  }
}

/* ============================================================
   GAME LOOP
============================================================ */
function gameLoop(timestamp) {
  if (!isLevelRunning) return;

  if (!startTimestamp) startTimestamp = timestamp;

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

  let perfect = 0; // tiles at stage 5
  let score = 0;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const t = tiles[y][x];

      // Perfect = tiles that reached stage 5 (passes >= PASSES_TO_FINISH)
      if (t.passes >= PASSES_TO_FINISH) perfect++;

      score += t.passes;
    }
  }

  // Update live run score (continues until failure)
  totalRunScore = score;

  document.getElementById("perfectDisplay").textContent = perfect;
  document.getElementById("scoreDisplay").textContent = totalRunScore;

  const savedBest = localStorage.getItem("concreteGameBestScore");
  if (savedBest !== null) bestScore = parseInt(savedBest);

  if (totalRunScore > bestScore) {
    bestScore = totalRunScore;
    localStorage.setItem("concreteGameBestScore", bestScore);
  }

  document.getElementById("bestDisplay").textContent = bestScore;
}

/* ============================================================
   FINISH LEVEL
============================================================ */
function finishLevel() {
  isLevelRunning = false;

  let perfect = 0; // tiles at stage 5
  let partial = 0;
  let total = cols * rows;
  let totalPasses = 0;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const t = tiles[y][x];
      totalPasses += t.passes;

      // PERFECT = tile reached stage 5 (5 passes)
      if (t.passes >= PASSES_TO_FINISH) {
        perfect++;
      } else if (t.passes > 0) {
        partial++;
      }
    }
  }

  // Must hit 80% of tiles at stage 5 to pass
  const pct = Math.round((perfect / total) * 100);
  const passed = pct >= 80;

  const title = passed
    ? "Level Passed!"
    : "Game Over";

  document.getElementById("message-title").textContent = title;
  document.getElementById("message-body").textContent =
    passed
      ? `Nice! You finished ${pct}% of the slab at stage 5.`
      : `You only got ${pct}% of the slab to stage 5. You need 80% to pass.`;

  document.getElementById("message-details").textContent =
    `Stage 5 tiles: ${perfect}/${total} (${pct}%) · Partial: ${partial} · Passes: ${totalPasses}`;

  showMessage();

  document.getElementById("nextLevelBtn").textContent =
    passed ? "Next level ▶" : "Try again 🔁";

  // Store result for button handler
  document.getElementById("nextLevelBtn").dataset.passed = passed;
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
   MOVEMENT
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

function startContinuousMove(direction) {
  currentDirection = direction;

  if (holdInterval) return;

  holdInterval = setInterval(() => {
    if (currentDirection === "up") moveTrowel(0, -1);
    if (currentDirection === "down") moveTrowel(0, 1);
    if (currentDirection === "left") moveTrowel(-1, 0);
    if (currentDirection === "right") moveTrowel(1, 0);
  }, MOVE_INTERVAL);
}

function stopContinuousMove() {
  currentDirection = null;
  if (holdInterval) {
    clearInterval(holdInterval);
    holdInterval = null;
  }
}

/* ============================================================
   CONTROLS
============================================================ */
window.addEventListener("keydown", e => {
  if (!isLevelRunning) return;
  const k = e.key.toLowerCase();

  if (k === "arrowup" || k === "w") moveTrowel(0, -1);
  else if (k === "arrowdown" || k === "s") moveTrowel(0, 1);
  else if (k === "arrowleft" || k === "a") moveTrowel(-1, 0);
  else if (k === "arrowright" || k === "d") moveTrowel(1, 0);
});

/* Mobile swipe */
canvas.addEventListener("touchstart", e => {
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
}, { passive: true });

canvas.addEventListener("touchmove", e => {
  const t = e.touches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;

  const minSwipe = 20;
  if (Math.abs(dx) < minSwipe && Math.abs(dy) < minSwipe) return;

  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > 0) startContinuousMove("right");
    else startContinuousMove("left");
  } else {
    if (dy > 0) startContinuousMove("down");
    else startContinuousMove("up");
  }
}, { passive: true });

canvas.addEventListener("touchend", stopContinuousMove);

/* ============================================================
   BUTTONS
============================================================ */

// Restart button = restart whole run from level 1
document.getElementById("restartButton").onclick = () => {
  totalRunScore = 0;
  currentLevelIndex = 0;
  setupLevel(0);
};

document.getElementById("helpButton").onclick = () => {
  alert(
    "Goal:\n" +
    "- Get at least 80% of tiles to stage 5 (5 passes) to pass the level.\n" +
    "- Your score carries forward until you fail.\n" +
    "- Tiles need 5 passes to fully finish.\n" +
    "- Swipe or use keys to move."
  );
};

// Next Level / Try Again button
document.getElementById("nextLevelBtn").onclick = () => {
  hideMessage();

  const passed = document.getElementById("nextLevelBtn").dataset.passed === "true";

  if (passed) {
    // Continue run
    if (currentLevelIndex < levels.length - 1) currentLevelIndex++;
    else currentLevelIndex = 0; // Loop after final level

    setupLevel(currentLevelIndex);
  } else {
    // Failed — reset run
    totalRunScore = 0;
    currentLevelIndex = 0;
    setupLevel(0);
  }
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
