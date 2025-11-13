/* ============================================================
   CONFIG
============================================================ */
const levels = [
  { cols: 6,  rows: 6,  levelTime: 60 },
  { cols: 8,  rows: 8,  levelTime: 70 },
  { cols: 8,  rows: 10, levelTime: 80 },
  { cols: 10, rows: 10, levelTime: 95 },
  { cols: 12, rows: 10, levelTime: 110 }
];

// SLOWER DRYING TIMES
const EDGE_DRY_TIME  = 15;
const INNER_DRY_TIME = 25;

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
let cols = 6;
let rows = 6;
let tileSize = 30;

let trowelX = 0;
let trowelY = 0;

let levelTime = 60;
let timeRemaining = 60;
let startTimestamp = null;
let isLevelRunning = false;

let lastFrameTime = null;
let bestScore = 0;

// Total score for this run (completed levels so far)
let totalRunScore = 0;

let touchStartX = null;
let touchStartY = null;

/* Swipe + hold */
let currentDirection = null;
let holdInterval = null;
const MOVE_INTERVAL = 150;

/* ============================================================
   LEADERBOARD HELPERS (TOP 5, 3-LETTER NAMES)
============================================================ */
function getLeaderboard() {
  try {
    const data = localStorage.getItem("concreteLeaderboard");
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

function saveLeaderboard(board) {
  localStorage.setItem("concreteLeaderboard", JSON.stringify(board));
}

function addToLeaderboard(name, score) {
  let board = getLeaderboard();
  board.push({ name, score });
  board.sort((a, b) => b.score - a.score); // highest first
  board = board.slice(0, 5); // keep top 5
  saveLeaderboard(board);
  updateLeaderboardSmall();
}

function qualifiesForLeaderboard(score) {
  const board = getLeaderboard();
  if (board.length < 5) return true;
  const lowest = board[board.length - 1].score;
  return score > lowest;
}

function buildLeaderboardHtml() {
  const board = getLeaderboard();
  if (!board.length) {
    return "<br><br><strong>Top Scores</strong><br>No scores yet.";
  }
  let html = "<br><br><strong>Top Scores</strong><br>";
  board.forEach((entry, idx) => {
    html += `${idx + 1}. ${entry.name} - ${entry.score}<br>`;
  });
  return html;
}

// Small leaderboard under the score stat
function updateLeaderboardSmall() {
  const board = getLeaderboard();
  const scoreSpan = document.getElementById("scoreDisplay");
  if (!scoreSpan) return;

  let container = document.getElementById("leaderboardSmall");
  if (!container) {
    container = document.createElement("div");
    container.id = "leaderboardSmall";
    container.style.fontSize = "0.7rem";
    container.style.marginTop = "2px";
    const parent = scoreSpan.parentElement;
    if (parent) parent.appendChild(container);
  }

  if (board.length === 0) {
    container.textContent = "Top 5: ---";
  } else {
    const parts = board.map(entry => `${entry.name} ${entry.score}`);
    container.textContent = "Top 5: " + parts.join(" · ");
  }
}

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

  // Start in the bottom-right corner
  trowelX = cols - 1;
  trowelY = rows - 1;

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

  let perfect = 0;     // tiles at stage 5
  let levelScore = 0;  // passes this level only

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const t = tiles[y][x];

      // Perfect = tiles that reached stage 5 (passes >= PASSES_TO_FINISH)
      if (t.passes >= PASSES_TO_FINISH) perfect++;

      levelScore += t.passes;
    }
  }

  const displayScore = totalRunScore + levelScore;

  document.getElementById("perfectDisplay").textContent = perfect;
  document.getElementById("scoreDisplay").textContent = displayScore;

  const savedBest = localStorage.getItem("concreteGameBestScore");
  if (savedBest !== null) bestScore = parseInt(savedBest);

  if (displayScore > bestScore) {
    bestScore = displayScore;
    localStorage.setItem("concreteGameBestScore", bestScore);
  }

  document.getElementById("bestDisplay").textContent = bestScore;

  // Keep small leaderboard visible
  updateLeaderboardSmall();
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

  // Add this level's passes to the run score
  totalRunScore += totalPasses;

  // Update best score based on full run score so far
  if (totalRunScore > bestScore) {
    bestScore = totalRunScore;
    localStorage.setItem("concreteGameBestScore", bestScore);
    document.getElementById("bestDisplay").textContent = bestScore;
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

  const baseDetails =
    `Run score: ${totalRunScore}<br>` +
    `Stage 5 tiles: ${perfect}/${total} (${pct}%) · Partial: ${partial} · Passes this level: ${totalPasses}`;

  const messageDetails = document.getElementById("message-details");

  if (passed) {
    // No leaderboard popup on pass
    messageDetails.innerHTML = baseDetails;
  } else {
    // On fail: if top 5, ask name (arcade style 3 letters)
    if (qualifiesForLeaderboard(totalRunScore)) {
      let name = prompt(
        `New high score: ${totalRunScore}!\nEnter your initials (3 letters):`,
        "AAA"
      );
      if (!name) name = "AAA";
      name = name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "AAA";
      addToLeaderboard(name, totalRunScore);
    }

    // Build big leaderboard for overlay
    const leaderboardHtml = buildLeaderboardHtml();
    messageDetails.innerHTML = baseDetails + leaderboardHtml;
  }

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
    if (currentDirection === "up")    moveTrowel(0, -1);
    if (currentDirection === "down")  moveTrowel(0, 1);
    if (currentDirection === "left")  moveTrowel(-1, 0);
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

  if (k === "arrowup" || k === "w")      moveTrowel(0, -1);
  else if (k === "arrowdown" || k === "s")  moveTrowel(0, 1);
  else if (k === "arrowleft" || k === "a")  moveTrowel(-1, 0);
  else if (k === "arrowright" || k === "d") moveTrowel(1, 0);
});

/* ============================================================
   MOBILE JOYSTICK
============================================================ */
const joy = document.getElementById("joystick");
const stick = document.getElementById("stick");

let joyCenterX, joyCenterY;
let joyActive = false;

function startJoystick(e) {
  joyActive = true;
  const rect = joy.getBoundingClientRect();
  joyCenterX = rect.left + rect.width / 2;
  joyCenterY = rect.top + rect.height / 2;
}

function moveJoystick(e) {
  if (!joyActive) return;

  const t = e.touches[0];
  const dx = t.clientX - joyCenterX;
  const dy = t.clientY - joyCenterY;

  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxDist = 40;

  let ndx = dx;
  let ndy = dy;

  if (dist > maxDist) {
    ndx = (dx / dist) * maxDist;
    ndy = (dy / dist) * maxDist;
  }

  stick.style.transform = `translate(${ndx}px, ${ndy}px)`;

  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  // Trigger movement directions
  if (absX > absY) {
    if (dx > 10) startContinuousMove("right");
    else if (dx < -10) startContinuousMove("left");
    else stopContinuousMove();
  } else {
    if (dy > 10) startContinuousMove("down");
    else if (dy < -10) startContinuousMove("up");
    else stopContinuousMove();
  }
}

function endJoystick() {
  joyActive = false;
  stick.style.transform = "translate(0px,0px)";
  stopContinuousMove();
}

joy.addEventListener("touchstart", startJoystick, { passive: true });
joy.addEventListener("touchmove",  moveJoystick,  { passive: true });
joy.addEventListener("touchend",   endJoystick);


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

  updateLeaderboardSmall();
  setupLevel(currentLevelIndex);
}

init();
