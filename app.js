// ============================================================
// Teleprompter Pro v2.1 — Voice Activity Engine (Event Frequency)
// ============================================================

const APP_VERSION = "v2.2";

// --- DOM ---
const editorContainer = document.getElementById('editor-container');
const prompterContainer = document.getElementById('prompter-container');
const textInput = document.getElementById('text-input');
const scrollContent = document.getElementById('scroll-content');
const startBtn = document.getElementById('start-btn');
const backBtn = document.getElementById('back-btn');
const playPauseBtn = document.getElementById('play-pause-btn');
const controlsOverlay = document.getElementById('controls-overlay');
const tapZone = document.getElementById('tap-zone');
const speedSlider = document.getElementById('speed-slider');
const sizeSlider = document.getElementById('size-slider');
const widthSlider = document.getElementById('width-slider');
const flipXBtn = document.getElementById('flip-x-btn');
const flipYBtn = document.getElementById('flip-y-btn');
const micToggle = document.getElementById('mic-toggle');
const languageSelect = document.getElementById('language-select');
const micStatusBar = document.getElementById('mic-status-bar');
const micStatusText = document.getElementById('mic-status-text');

// --- State ---
let isPlaying = false;
let baseSpeed = 25;
let currentScrollPos = 0;
let targetScrollPos = 0;
const LERP = 0.12;

let isPrompterActive = false;
let flipX = false, flipY = false;
let animFrameId;
let lastFrameTime = 0;

// Touch
let isDragging = false;
let touchStartY = 0;
let lastTouchY = 0;
const DRAG_THRESHOLD = 8;

// ============================================================
// SPEECH ENGINE — Event Frequency Based
// ============================================================
// How it works:
// - When mic is on, every time Web Speech API fires `onresult`,
//   we record a timestamp.
// - We measure how many events fired in the last 2 seconds.
// - More events = faster speech = higher scroll multiplier.
// - No events for 1s = silence = pause.
//
// This is robust because:
// - We don't care WHAT was said, only that speech is happening
// - Works identically for any language
// - interimResults firing frequently = speech is active
// ============================================================

let recognition = null;
let isMicActive = false;
let speechMultiplier = 0;       // 0 = paused, ~1 = normal, >1 = fast
let targetMultiplier = 0;       // Target for smooth transitions
let resultTimestamps = [];      // Timestamps of onresult events
let silenceTimer = null;
let wasSilent = true;           // Track if we were just silent (for burst)
const SILENCE_MS = 700;         // Pause after 700ms silence
const RATE_WINDOW = 1500;       // Measure over 1.5s window (smoother)

// Calibration
const EVENTS_FOR_NORMAL = 4;    // events/sec → multiplier 1.0
const MAX_MULTIPLIER = 1.6;     // Cap max speed swing (was 2.5)
const MULTIPLIER_LERP = 0.08;   // Slow smooth transitions (was 0.3)

// ============================================================
// INIT
// ============================================================
function init() {
    const saved = localStorage.getItem('teleprompter_text');
    if (saved) textInput.value = saved;

    // Auto-select language from browser, matching closest option
    autoSelectLanguage();

    // Restore settings
    const ss = localStorage.getItem('tp_speed');
    const sz = localStorage.getItem('tp_size');
    const wd = localStorage.getItem('tp_width');
    if (ss) { speedSlider.value = ss; baseSpeed = +ss; }
    if (sz) sizeSlider.value = sz;
    if (wd) widthSlider.value = wd;
    updateDisplays();
}

function updateDisplays() {
    document.getElementById('speed-display').innerText = speedSlider.value;
    document.getElementById('size-display').innerText = sizeSlider.value;
    document.getElementById('width-display').innerText = widthSlider.value + '%';
}

function autoSelectLanguage() {
    const browserLang = navigator.language || navigator.userLanguage || 'en-US';
    const options = Array.from(languageSelect.options);
    // Try exact match (e.g. 'el-GR')
    const exact = options.find(o => o.value === browserLang);
    if (exact) { languageSelect.value = exact.value; return; }
    // Try prefix match (e.g. 'el' matches 'el-GR')
    const prefix = browserLang.split('-')[0];
    const partial = options.find(o => o.value.startsWith(prefix));
    if (partial) { languageSelect.value = partial.value; return; }
    // Fallback: first option stays selected
}

// ============================================================
// EVENT LISTENERS
// ============================================================

startBtn.addEventListener('click', () => {
    const text = textInput.value.trim();
    if (!text) return alert('Please enter some text!');
    localStorage.setItem('teleprompter_text', text);
    enterPrompter(text);
});

backBtn.addEventListener('click', exitPrompter);

playPauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlay();
});

speedSlider.addEventListener('input', () => {
    baseSpeed = +speedSlider.value;
    localStorage.setItem('tp_speed', speedSlider.value);
    updateDisplays();
});
sizeSlider.addEventListener('input', () => {
    localStorage.setItem('tp_size', sizeSlider.value);
    updateDisplays();
    applyVisuals();
});
widthSlider.addEventListener('input', () => {
    localStorage.setItem('tp_width', widthSlider.value);
    updateDisplays();
    applyVisuals();
});

flipXBtn.addEventListener('click', (e) => { e.stopPropagation(); flipX = !flipX; applyTransform(); });
flipYBtn.addEventListener('click', (e) => { e.stopPropagation(); flipY = !flipY; applyTransform(); });
micToggle.addEventListener('click', (e) => { e.stopPropagation(); toggleMic(); });

// --- Touch ---
tapZone.addEventListener('touchstart', (e) => {
    isDragging = false;
    touchStartY = e.touches[0].clientY;
    lastTouchY = touchStartY;
}, { passive: true });

tapZone.addEventListener('touchmove', (e) => {
    const y = e.touches[0].clientY;
    if (Math.abs(y - touchStartY) > DRAG_THRESHOLD) {
        isDragging = true;
        e.preventDefault();
        const delta = lastTouchY - y;
        targetScrollPos += delta;
        if (targetScrollPos < 0) targetScrollPos = 0;
        currentScrollPos = targetScrollPos;
        applyTransform();
    }
    lastTouchY = y;
}, { passive: false });

tapZone.addEventListener('touchend', () => {
    if (!isDragging) toggleControls();
    isDragging = false;
});

// Desktop click
tapZone.addEventListener('click', () => {
    if (!('ontouchstart' in window)) toggleControls();
});

// ============================================================
// PROMPTER
// ============================================================

function enterPrompter(text) {
    scrollContent.innerText = text;
    editorContainer.classList.remove('active');
    prompterContainer.classList.add('active');
    isPrompterActive = true;

    currentScrollPos = 0;
    targetScrollPos = 0;
    isPlaying = false;
    updatePlayBtn();
    applyVisuals();
    applyTransform();

    lastFrameTime = performance.now();
    requestAnimationFrame(loop);
}

function exitPrompter() {
    isPrompterActive = false;
    isPlaying = false;
    stopMic();
    cancelAnimationFrame(animFrameId);
    prompterContainer.classList.remove('active');
    editorContainer.classList.add('active');
}

function togglePlay() {
    isPlaying = !isPlaying;
    updatePlayBtn();
    if (isPlaying) controlsOverlay.classList.add('hidden');
}

function updatePlayBtn() {
    playPauseBtn.innerText = isPlaying ? '⏸' : '▶';
    playPauseBtn.classList.toggle('playing', isPlaying);
}

function toggleControls() {
    controlsOverlay.classList.toggle('hidden');
}

function applyVisuals() {
    scrollContent.style.fontSize = sizeSlider.value + 'px';
    scrollContent.style.width = widthSlider.value + '%';
}

function applyTransform() {
    let t = `translateX(-50%) translate3d(0, ${-currentScrollPos}px, 0)`;
    if (flipX && flipY) t += ' scale(-1,-1)';
    else if (flipX) t += ' scaleX(-1)';
    else if (flipY) t += ' scaleY(-1)';
    scrollContent.style.transform = t;
}

// ============================================================
// RENDER LOOP
// ============================================================

function loop(ts) {
    if (!isPrompterActive) return;

    const dt = Math.min((ts - lastFrameTime) / 1000, 0.1); // Cap to avoid jumps
    lastFrameTime = ts;

    let speed = 0;

    if (isMicActive) {
        // Voice-driven: smooth the multiplier toward target
        speechMultiplier += (targetMultiplier - speechMultiplier) * MULTIPLIER_LERP;
        if (speechMultiplier < 0.05) speechMultiplier = 0; // Snap to zero
        speed = speechMultiplier * baseSpeed;
    } else if (isPlaying && !isDragging) {
        speed = baseSpeed * 1.5;
    }

    if (speed > 0) {
        targetScrollPos += speed * dt;
    }

    // Lerp
    if (!isDragging) {
        const diff = targetScrollPos - currentScrollPos;
        if (Math.abs(diff) > 0.3) {
            currentScrollPos += diff * LERP;
            applyTransform();
        }
    }

    animFrameId = requestAnimationFrame(loop);
}

// ============================================================
// SPEECH — Event Frequency Engine
// ============================================================

function toggleMic() {
    if (isMicActive) stopMic();
    else startMic();
}

function startMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return alert('Speech not supported. Use Chrome.');

    recognition = new SR();
    recognition.lang = languageSelect.value; // Use selected language
    recognition.continuous = true;
    recognition.interimResults = true;    // Key: gives us frequent events
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        isMicActive = true;
        speechMultiplier = 0;
        targetMultiplier = 0;
        resultTimestamps = [];
        wasSilent = true;
        micToggle.classList.add('active');
        micStatusBar.classList.remove('hidden');
        micStatusText.innerText = 'Ready — speak to scroll';

        // Disable manual play
        isPlaying = false;
        updatePlayBtn();
    };

    recognition.onend = () => {
        if (isMicActive) {
            // Auto-restart (Chrome/Android kills recognition periodically)
            try { recognition.start(); } catch (e) { }
        } else {
            micToggle.classList.remove('active');
            micStatusBar.classList.add('hidden');
        }
    };

    recognition.onerror = (e) => {
        console.warn('Speech error:', e.error);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            alert('Microphone access denied.');
            stopMic();
        }
        // 'no-speech' is normal — just means silence, don't stop
    };

    recognition.onresult = () => {
        const now = performance.now();
        resultTimestamps.push(now);

        // Trim to rate window
        const cutoff = now - RATE_WINDOW;
        resultTimestamps = resultTimestamps.filter(t => t > cutoff);

        // If resuming from silence, immediately jump to normal speed
        if (wasSilent) {
            targetMultiplier = 1.0;
            speechMultiplier = 0.5; // Gentle kick, lerp will smooth the rest
            wasSilent = false;
        } else {
            // Calculate events per second in the window
            const elapsed = (now - resultTimestamps[0]) / 1000;
            const eps = resultTimestamps.length / Math.max(elapsed, 0.3);

            // Map to multiplier
            targetMultiplier = Math.min(eps / EVENTS_FOR_NORMAL, MAX_MULTIPLIER);
            if (targetMultiplier < 0.4) targetMultiplier = 0.4;
        }

        // Update UI
        const pct = Math.round(targetMultiplier * 100);
        micStatusText.innerText = `Speaking — ${pct}% speed`;

        // Reset silence timer
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
            targetMultiplier = 0;
            wasSilent = true;
            micStatusText.innerText = 'Paused — waiting for speech';
        }, SILENCE_MS);
    };

    recognition.start();
}

function stopMic() {
    isMicActive = false;
    speechMultiplier = 0;
    clearTimeout(silenceTimer);
    if (recognition) {
        try { recognition.stop(); } catch (e) { }
    }
    micToggle.classList.remove('active');
    micStatusBar.classList.add('hidden');
}

// ============================================================
init();
