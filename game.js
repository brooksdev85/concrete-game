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

/* ============================================================
   MOVEMENT TIMING (Speed A)
   - Fast response
   - Slightly slower stepping to avoid "jumping 2-4 tiles"
============================================================ */
let currentDirection = null;
let holdInterval = null;

// continuous movement tick (slightly slower than your super-fast version)
const MOVE_INTERVAL = 95;

// minimum time between any two moves (prevents double-steps on flicks)
let lastMoveAt = 0;
const MIN_STEP_MS = 70;

/* ============================================================
   START SCREEN FLAGS
============================================================ */
let showStartScreen = true;
let hasStartedGame = false;

/* ============================================================
   FIREBASE LEADERBOARD (GLOBAL)
============================================================ */
let fbDb = null;
let fbAddDoc = null;
let fbCollection = null;
let fbQuery = null;
let fbOrderBy = null;
let fbLimitFn = null;
let fbGetDocs = null;

let globalLeaderboard = [];
let playerName = localStorage.getItem("concretePlayerName") || "";

function initFirebaseRefs() {
  if (!window._firebase) {
    console.warn("Firebase not available on window._firebase");
    return;
  }
  const {
    db,
    addDoc,
    collection,
    query,
    orderBy,
    limit,
    getDocs
  } = window._firebase;

  fbDb = db;
  fbAddDoc = addDoc;
  fbCollection = collection;
  fbQuery = query;
  fbOrderBy = orderBy;
  fbLimitFn = limit;
  fbGetDocs = getDocs;
}

async function submitScoreToFirebase(name, score) {
  if (!fbDb || !fbAddDoc || !fbCollection) return;
  try {
    await fbAddDoc(fbCollection(fbDb, "leaderboard"), { name, score });
  } catch (err) {
    console.error("Error submitting score to Firebase:", err);
  }
}

async function refreshGlobalLeaderboard() {
  if (!fbDb || !fbQuery || !fbCollection || !fbOrderBy || !fbLimitFn || !fbGetDocs) return;
  try {
    const q = fbQuery(
      fbCollection(fbDb, "leaderboard"),
      fbOrderBy("score", "desc"),
      fbLimitFn(5)
    );
    const snap = await fbGetDocs(q);
    globalLeaderboard = snap.docs.map(doc => doc.data());
    updateLeaderboardSmall();
  } catch (err) {
    console.error("Error loading leaderboard from Firebase:", err);
  }
}

function qualifiesForLeaderboard(score) {
  if (!globalLeaderboard || globalLeaderboard.length === 0) return true;
  if (globalLeaderboard.length < 5) return true;
  const lowest = globalLeaderboard[globalLeaderboard.length - 1].score;
  return score > lowest;
}

function buildLeaderboardHtml() {
  if (!globalLeaderboard || globalLeaderboard.length === 0) {
    return "<br><br><strong>Top Scores (Global)</strong><br>No scores yet.";
  }
  let html = "<br><br><strong>Top Scores (Global)</strong><br>";
  globalLeaderboard.forEach((entry, idx) => {
    html += `${idx + 1}. ${entry.name} - ${entry.score}<br>`;
  });
  return html;
}

function updateLeaderboardSmall() {
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

  if (!globalLeaderboard || globalLeaderboard.length === 0) {
    container.textContent = "Top 5 (Global): ---";
  } else {
    const parts = globalLeaderboard.map(entry => `${entry.name} ${entry.score}`);
    container.textContent = "Top 5 (Global): " + parts.join(" · ");
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

  tiles = [];
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) {
      row.push(createTile(isEdgeTile(x, y, cols, rows)));
    }
    tiles.push(row);
  }

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
  if (isLevelRunning) {
    drawGame(0);
  } else if (showStartScreen) {
    drawStartScreen();
  }
});

/* ============================================================
   START SCREEN DRAW
============================================================ */
function drawStartScreen() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";

  ctx.font = "28px Arial";
  ctx.fillText("Concrete Power Trowel", canvas.width / 2, canvas.height / 2 - 40);

  ctx.font = "20px Arial";
  ctx.fillText("Press any arrow key or move the joystick to start", canvas.width / 2, canvas.height / 2 + 5);

  ctx.font = "16px Arial";
  ctx.fillText("Keyboard: Arrow keys or WASD", canvas.width / 2, canvas.height / 2 + 40);
  ctx.fillText("Mobile: Use the on-screen joystick", canvas.width / 2, canvas.height / 2 + 65);
}

/* ============================================================
   DRAWING
============================================================ */
function drawGame(gameTime) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

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
  if (showStartScreen) {
    drawStartScreen();
    requestAnimationFrame(gameLoop);
    return;
  }

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

  let perfect = 0;
  let levelScore = 0;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const t = tiles[y][x];
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
  updateLeaderboardSmall();
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

      if (t.passes >= PASSES_TO_FINISH) perfect++;
      else if (t.passes > 0) partial++;
    }
  }

  totalRunScore += totalPasses;

  if (totalRunScore > bestScore) {
    bestScore = totalRunScore;
    localStorage.setItem("concreteGameBestScore", bestScore);
    document.getElementById("bestDisplay").textContent = bestScore;
  }

  const pct = Math.round((perfect / total) * 100);
  const passed = pct >= 80;

  const title = passed ? "Level Passed!" : "Game Over";

  document.getElementById("message-title").textContent = title;
  document.getElementById("message-body").textContent =
    passed
      ? `Nice! You finished ${pct}% of the slab at stage 5.`
      : `You only got ${pct}% of the slab to stage 5. You need 80% to pass.`;

  const baseDetails =
    `Run score: ${totalRunScore}<br>` +
    `Stage 5 tiles: ${perfect}/${total} (${pct}%) · Partial: ${partial} · Passes this level: ${totalPasses}`;

  const messageDetails = document.getElementById("message-details");
  let detailsHtml = baseDetails;

  if (!passed) {
    if (qualifiesForLeaderboard(totalRunScore)) {
      let defaultName = playerName || "AAA";
      let name = prompt(
        `New high score: ${totalRunScore}!\nEnter your initials (3 letters):`,
        defaultName
      );
      if (!name) name = defaultName || "AAA";
      name = name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "AAA";

      playerName = name;
      localStorage.setItem("concretePlayerName", playerName);

      globalLeaderboard.push({ name: playerName, score: totalRunScore });
      globalLeaderboard.sort((a, b) => b.score - a.score);
      globalLeaderboard = globalLeaderboard.slice(0, 5);
      updateLeaderboardSmall();

      submitScoreToFirebase(playerName, totalRunScore);
    }

    const leaderboardHtml = buildLeaderboardHtml();
    detailsHtml = baseDetails + leaderboardHtml;
  }

  messageDetails.innerHTML = detailsHtml;
  showMessage();

  document.getElementById("nextLevelBtn").textContent =
    passed ? "Next level ▶" : "Try again 🔁";

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
   MOVEMENT (optimized direction switching)
============================================================ */
function moveTrowel(dx, dy) {
  if (!isLevelRunning) return;

  const now = performance.now();
  if (now - lastMoveAt < MIN_STEP_MS) return;
  lastMoveAt = now;

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

function setDirection(direction) {
  if (!direction) return;

  if (currentDirection !== direction) {
    currentDirection = direction;

    // direction change = immediate ONE step (keeps it feeling responsive)
    if (direction === "up")    moveTrowel(0, -1);
    if (direction === "down")  moveTrowel(0, 1);
    if (direction === "left")  moveTrowel(-1, 0);
    if (direction === "right") moveTrowel(1, 0);

    // restart interval so new direction feels instant
    if (holdInterval) {
      clearInterval(holdInterval);
      holdInterval = null;
    }
  }

  if (!holdInterval) {
    holdInterval = setInterval(() => {
      if (currentDirection === "up")    moveTrowel(0, -1);
      if (currentDirection === "down")  moveTrowel(0, 1);
      if (currentDirection === "left")  moveTrowel(-1, 0);
      if (currentDirection === "right") moveTrowel(1, 0);
    }, MOVE_INTERVAL);
  }
}

function stopContinuousMove() {
  currentDirection = null;
  if (holdInterval) {
    clearInterval(holdInterval);
    holdInterval = null;
  }
}

/* ============================================================
   CONTROLS (keyboard)
============================================================ */
window.addEventListener("keydown", e => {
  const k = e.key.toLowerCase();

  if (showStartScreen) {
    if (["arrowup","arrowdown","arrowleft","arrowright","w","a","s","d"].includes(k)) {
      startGameNow();
    }
    return;
  }

  if (!isLevelRunning) return;

  if (k === "arrowup" || k === "w")         moveTrowel(0, -1);
  else if (k === "arrowdown" || k === "s")  moveTrowel(0, 1);
  else if (k === "arrowleft" || k === "a")  moveTrowel(-1, 0);
  else if (k === "arrowright" || k === "d") moveTrowel(1, 0);
});

/* ============================================================
   SINGLE FLOATING JOYSTICK — ANYWHERE ON SCREEN
============================================================ */
const joy = document.getElementById("joystick");
const stick = document.getElementById("stick");

let joyActive = false;
let joyTouchId = null;
let joyCenterX = 0;
let joyCenterY = 0;

const JOY_RADIUS = 60;        // matches CSS / comfortable thumb zone
const DEAD_ZONE = 10;
const DOMINANCE_RATIO = 1.15; // diagonal hysteresis (feels pro)

/* ============================================================
   PREVENT PAGE SCROLL WHILE JOYSTICK IS ACTIVE
============================================================ */
document.body.addEventListener("touchmove", function (e) {
  if (joyActive) {
    e.preventDefault();
  }
}, { passive: false });

joy.style.display = "none";

// helper so joystick doesn't spawn on top-bar/buttons/overlay
function shouldIgnoreTouchTarget(target) {
  return !!(
    target.closest("#top-bar") ||
    target.closest("#buttons") ||
    target.closest("button") ||
    target.closest("#message-overlay")
  );
}

// Touch start ANYWHERE
window.addEventListener("touchstart", (e) => {
  if (joyActive) return;

  const touch = e.changedTouches[0];
  if (!touch) return;

  if (shouldIgnoreTouchTarget(e.target)) return;

  joyTouchId = touch.identifier;
  joyActive = true;

  joyCenterX = touch.clientX;
  joyCenterY = touch.clientY;

  joy.style.left = (joyCenterX - JOY_RADIUS) + "px";
  joy.style.top  = (joyCenterY - JOY_RADIUS) + "px";
  joy.style.display = "flex";

  if (showStartScreen) startGameNow();
}, { passive: true });

window.addEventListener("touchmove", (e) => {
  if (!joyActive) return;

  const touch = [...e.changedTouches].find(t => t.identifier === joyTouchId);
  if (!touch) return;

  e.preventDefault();

  const dx = touch.clientX - joyCenterX;
  const dy = touch.clientY - joyCenterY;

  const dist = Math.sqrt(dx*dx + dy*dy);
  const maxMove = JOY_RADIUS - 18;

  let clampedX = dx;
  let clampedY = dy;

  if (dist > maxMove) {
    const scale = maxMove / dist;
    clampedX = dx * scale;
    clampedY = dy * scale;
  }

  stick.style.transform = `translate(${clampedX}px, ${clampedY}px)`;

  if (dist < DEAD_ZONE) {
    stopContinuousMove();
    return;
  }

  const absX = Math.abs(clampedX);
  const absY = Math.abs(clampedY);

  let direction;

  if (absX > absY * DOMINANCE_RATIO) {
    direction = clampedX > 0 ? "right" : "left";
  } else if (absY > absX * DOMINANCE_RATIO) {
    direction = clampedY > 0 ? "down" : "up";
  } else {
    direction = currentDirection || (absX >= absY
      ? (clampedX > 0 ? "right" : "left")
      : (clampedY > 0 ? "down" : "up"));
  }

  setDirection(direction);
}, { passive: false });

window.addEventListener("touchend", (e) => {
  const touch = [...e.changedTouches].find(t => t.identifier === joyTouchId);
  if (!touch) return;

  joyActive = false;
  joyTouchId = null;

  joy.style.display = "none";
  stick.style.transform = "translate(0px,0px)";
  stopContinuousMove();
}, { passive: true });

window.addEventListener("touchcancel", () => {
  joyActive = false;
  joyTouchId = null;

  joy.style.display = "none";
  stick.style.transform = "translate(0px,0px)";
  stopContinuousMove();
}, { passive: true });

/* ============================================================
   BUTTONS
============================================================ */
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

document.getElementById("nextLevelBtn").onclick = () => {
  hideMessage();

  const passed = document.getElementById("nextLevelBtn").dataset.passed === "true";

  if (passed) {
    if (currentLevelIndex < levels.length - 1) currentLevelIndex++;
    else currentLevelIndex = 0;
    setupLevel(currentLevelIndex);
  } else {
    totalRunScore = 0;
    currentLevelIndex = 0;
    setupLevel(0);
  }
};

/* ============================================================
   START GAME LOGIC
============================================================ */
function startGameNow() {
  if (hasStartedGame) return;
  hasStartedGame = true;
  showStartScreen = false;

  totalRunScore = 0;
  currentLevelIndex = 0;

  setupLevel(0);
}

/* ============================================================
   INIT
============================================================ */
function init() {
  const saved = localStorage.getItem("concreteGameBestScore");
  if (saved) bestScore = parseInt(saved);
  document.getElementById("bestDisplay").textContent = bestScore;

  initFirebaseRefs();
  refreshGlobalLeaderboard();
  updateLeaderboardSmall();

  showStartScreen = true;
  hasStartedGame = false;
  resizeCanvas();
  drawStartScreen();
  requestAnimationFrame(gameLoop);
}

init();
