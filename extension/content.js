// ============================================================
// content.js — Runs INSIDE the YouTube tab
// ============================================================
// Live Mongolian subtitles WITHOUT fetching YouTube's caption
// tracks. Instead we read the captions YouTube already paints on
// screen (.ytp-caption-segment) via a MutationObserver, translate
// each settled line through our backend, and draw the Mongolian
// into our own overlay.
//
// Why this beats caption-track fetching:
//   - No timedtext / ytInitialPlayerResponse scraping (brittle,
//     breaks on YouTube changes, blocked from datacenter IPs).
//   - Works for any video whose captions render on screen, incl.
//     auto-generated ones.
//   - The only network call is to OUR backend, from the user's IP.
//
// Tradeoff: it's a LIVE read, so the Mongalian line lands a beat
// after the caption appears (translation round-trip). We debounce
// so rolling auto-captions settle into a full line first.
// ============================================================

// ── CONFIG ──────────────────────────────────────────────────
const SETTLE_MS = 450; // wait for the caption line to stop changing before translating

// ── STATE ───────────────────────────────────────────────────
let currentVideoId = null;
let enabled = false; // is the translated-subtitle overlay turned on?
let toggleButton = null;
let overlayEl = null; // our injected Mongolian subtitle div
let captionObserver = null; // watches the player for caption changes
let settleTimer = null; // debounce timer for a settling caption line
let lastSourceText = ""; // dedup guard — the last English line we acted on
let translateSeq = 0; // guards against out-of-order translation responses

// ── INITIALIZATION ──────────────────────────────────────────
// YouTube is a Single Page App: clicking a new video changes the
// URL without reloading, so content.js does not re-run. Watch for it.
function init() {
  console.log("[SightAhead] Content script loaded");
  currentVideoId = extractVideoId();
  injectToggleButton();
  watchForNavigation();
}

function watchForNavigation() {
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onVideoChanged();
    }
  }, 1000);
}

function onVideoChanged() {
  const videoId = extractVideoId();
  if (videoId && videoId !== currentVideoId) {
    currentVideoId = videoId;
    console.log("[SightAhead] New video:", currentVideoId);
    // New player DOM — drop stale state and re-arm if we were on.
    lastSourceText = "";
    setOverlayText("");
    if (enabled) startObserving();
    if (!document.getElementById("sightahead-sub-btn")) injectToggleButton();
  }
}

// ── VIDEO ID EXTRACTION ─────────────────────────────────────
function extractVideoId() {
  return new URL(window.location.href).searchParams.get("v");
}

// ── UI: TOGGLE BUTTON ───────────────────────────────────────
// Injected next to YouTube's like/share buttons. Turns the live
// translated-subtitle overlay on and off.
function injectToggleButton() {
  let attempts = 0;
  const maxAttempts = 60;

  const wait = setInterval(() => {
    if (++attempts > maxAttempts) {
      clearInterval(wait);
      console.warn("[SightAhead] Actions bar not found; button not injected.");
      return;
    }

    const actionsBar =
      document.querySelector("#actions #top-level-buttons-computed") ||
      document.querySelector("#actions");
    if (!actionsBar) return;

    clearInterval(wait);
    if (document.getElementById("sightahead-sub-btn")) return;

    toggleButton = document.createElement("button");
    toggleButton.id = "sightahead-sub-btn";
    toggleButton.className = "sightahead-btn";
    toggleButton.addEventListener("click", toggleSubtitles);
    actionsBar.appendChild(toggleButton);
    renderButton();
    console.log("[SightAhead] Button injected, video:", currentVideoId);
  }, 500);
}

function renderButton(text) {
  if (!toggleButton) return;
  toggleButton.textContent =
    text ?? (enabled ? "🇲🇳 Монгол хадмал: ON" : "🇲🇳 Монгол хадмал: OFF");
  toggleButton.classList.toggle("sightahead-active", enabled);
}

function toggleSubtitles() {
  enabled = !enabled;
  renderButton();
  if (enabled) {
    document.body.classList.add("sightahead-on"); // CSS hides native captions
    ensureCaptionsOn();
    startObserving();
  } else {
    document.body.classList.remove("sightahead-on");
    stopObserving();
    setOverlayText("");
  }
}

// ── CAPTION CAPTURE ─────────────────────────────────────────
// Make sure YouTube is actually rendering captions — we need the
// DOM nodes to exist before there is anything to read.
function ensureCaptionsOn() {
  const ccButton = document.querySelector(".ytp-subtitles-button");
  if (ccButton && ccButton.getAttribute("aria-pressed") === "false") {
    ccButton.click();
    console.log("[SightAhead] Enabled captions automatically");
  }
}

// Read whatever caption text is on screen right now. YouTube splits
// one line across several .ytp-caption-segment nodes, so join them.
function readCaption() {
  const segments = document.querySelectorAll(".ytp-caption-segment");
  return Array.from(segments)
    .map((el) => el.textContent)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function startObserving() {
  const player =
    document.querySelector("#movie_player") ||
    document.querySelector(".html5-video-player");
  if (!player) {
    // Player not built yet (SPA). Retry shortly while still enabled.
    if (enabled) setTimeout(startObserving, 1000);
    return;
  }

  ensureOverlay(player);
  stopObserving();

  // Observe the whole player subtree: the caption window is created
  // and destroyed as captions come and go, so watching a stable
  // ancestor is more reliable than the caption container itself.
  captionObserver = new MutationObserver(onCaptionMutation);
  captionObserver.observe(player, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  console.log("[SightAhead] Observing captions");
}

function stopObserving() {
  if (captionObserver) {
    captionObserver.disconnect();
    captionObserver = null;
  }
  clearTimeout(settleTimer);
  settleTimer = null;
}

// We ignore the mutation records themselves — they are just a
// "something changed, go re-read" signal. Debounce so a rolling
// auto-caption settles into a complete line before we translate it.
function onCaptionMutation() {
  const text = readCaption();
  if (!text || text === lastSourceText) return;

  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    const settled = readCaption();
    if (!settled || settled === lastSourceText) return;
    lastSourceText = settled;
    handleLine(settled);
  }, SETTLE_MS);
}

// ── TRANSLATION ─────────────────────────────────────────────
// Hand the settled English line to the background worker (CORS-free,
// user's IP) and paint the Mongolian back. A sequence guard drops
// responses that arrive after a newer line has already been shown.
async function handleLine(text) {
  const seq = ++translateSeq;
  try {
    const res = await sendMessage({ type: "TRANSLATE_LINE", text });
    if (seq !== translateSeq) return; // a newer line superseded this one
    if (res && res.success && res.data && res.data.translated) {
      setOverlayText(res.data.translated);
    }
  } catch (err) {
    console.warn("[SightAhead] translate failed:", err.message);
  }
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ── OVERLAY ─────────────────────────────────────────────────
// Lives INSIDE the player element so it stays visible in fullscreen
// (a body-level fixed element would vanish when the player goes FS).
function ensureOverlay(player) {
  if (overlayEl && overlayEl.isConnected) return overlayEl;
  overlayEl = document.createElement("div");
  overlayEl.id = "sightahead-overlay";
  player.appendChild(overlayEl);
  return overlayEl;
}

function setOverlayText(text) {
  if (!overlayEl || !overlayEl.isConnected) {
    const player =
      document.querySelector("#movie_player") ||
      document.querySelector(".html5-video-player");
    if (player) ensureOverlay(player);
  }
  if (!overlayEl) return;
  overlayEl.textContent = text || "";
  overlayEl.style.display = text ? "block" : "none";
}

// ── START ───────────────────────────────────────────────────
init();
