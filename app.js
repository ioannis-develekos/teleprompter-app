// ============================================================
// Teleprompter Pro v2.0 — Voice Activity + Speech Rate Engine
// ============================================================

const APP_VERSION = "v2.0";

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
let isPlaying = false;   // Manual scroll active
let baseSpeed = 25;      // Base px/sec from slider
let currentScrollPos = 0;
let targetScrollPos = 0;
const LERP = 0.12;

let isPrompterActive = false;
let flipX = false, flipY = false;
let animFrameId;

// Touch
let isDragging = false;
let touchStartY = 0;
let lastTouchY = 0;
const DRAG_THRESHOLD = 8; // px before we consider it a drag

// Speech / Voice Activity
let recognition = null;
let isMicActive = false;
let speechSpeed = 0;      // Dynamic multiplier from speech rate
let lastSpeechTime = 0;
let silenceTimeout = null;
const SILENCE_DELAY = 1200;   // ms of silence before pausing
let wordTimestamps = [];     // For calculating speech rate

// ============================================================
// INIT
// ============================================================
function init() {
    const saved = localStorage.getItem('teleprompter_text');
    if (saved) textInput.value = saved;

    // Restore slider values
    const ss = localStorage.getItem('tp_speed');
    const sz = localStorage.getItem('tp_size');
    const wd = localStorage.getItem('tp_width');
    if (ss) { speedSlider.value = ss; baseSpeed = +ss; }
    if (sz) { sizeSlider.value = sz; }
    if (wd) { widthSlider.value = wd; }
    updateDisplays();
}

function updateDisplays() {
    document.getElementById('speed-display').innerText = speedSlider.value;
    document.getElementById('size-display').innerText = sizeSlider.value;
    document.getElementById('width-display').innerText = widthSlider.value + '%';
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

// Sliders
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

// --- Touch Handling ---
// Goal: short tap = toggle controls, drag = manual scroll

tapZone.addEventListener('touchstart', (e) => {
    isDragging = false;
    touchStartY = e.touches[0].clientY;
    lastTouchY = touchStartY;
}, { passive: true });

tapZone.addEventListener('touchmove', (e) => {
    const y = e.touches[0].clientY;
    const totalDelta = Math.abs(y - touchStartY);

    if (totalDelta > DRAG_THRESHOLD) {
        isDragging = true;
        e.preventDefault();

        const delta = lastTouchY - y; // positive = scroll down
        targetScrollPos += delta;
        if (targetScrollPos < 0) targetScrollPos = 0;
        currentScrollPos = targetScrollPos;
        applyTransform();
    }
    lastTouchY = y;
}, { passive: false });

tapZone.addEventListener('touchend', () => {
    if (!isDragging) {
        // It was a tap → toggle controls
        toggleControls();
    }
    isDragging = false;
});

// Mouse click fallback (desktop)
tapZone.addEventListener('click', (e) => {
    // On desktop, click = toggle controls
    // On mobile, touchend already handles it; click fires after but isDragging is reset
    // So this is mainly for desktop
    if (!('ontouchstart' in window)) {
        toggleControls();
    }
});

// ============================================================
// PROMPTER CORE
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

    // Start render loop
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
    if (isPlaying) {
        controlsOverlay.classList.add('hidden');
    }
}

function updatePlayBtn() {
    if (isPlaying) {
        playPauseBtn.innerText = '⏸';
        playPauseBtn.classList.add('playing');
    } else {
        playPauseBtn.innerText = '▶';
        playPauseBtn.classList.remove('playing');
    }
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
let lastFrameTime = 0;

function loop(ts) {
    if (!isPrompterActive) return;

    const dt = (ts - lastFrameTime) / 1000;
    lastFrameTime = ts;

    // --- Determine effective speed ---
    let effectiveSpeed = 0;

    if (isMicActive) {
        // Voice-controlled: speechSpeed is set by speech rate detection
        effectiveSpeed = speechSpeed * baseSpeed;
    } else if (isPlaying && !isDragging) {
        // Manual play mode
        effectiveSpeed = baseSpeed * 1.5;
    }

    if (effectiveSpeed > 0) {
        targetScrollPos += effectiveSpeed * dt;
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
// SPEECH ENGINE — Voice Activity + Speech Rate
// ============================================================

function toggleMic() {
    if (isMicActive) stopMic();
    else startMic();
}

function startMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return alert('Speech API not supported. Use Chrome.');

    recognition = new SR();
    recognition.lang = languageSelect.value;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        isMicActive = true;
        speechSpeed = 0;
        wordTimestamps = [];
        micToggle.classList.add('active');
        micStatusBar.classList.remove('hidden');
        micStatusText.innerText = 'Listening — speak to scroll';

        // Pause manual play if active
        isPlaying = false;
        updatePlayBtn();
    };

    recognition.onend = () => {
        if (isMicActive) {
            // Auto-restart (Android/Chrome kills it periodically)
            try { recognition.start(); } catch (e) { }
        } else {
            micToggle.classList.remove('active');
            micStatusBar.classList.add('hidden');
        }
    };

    recognition.onerror = (e) => {
        console.warn('Speech error:', e.error);
        if (e.error === 'not-allowed') {
            alert('Microphone access denied. Please allow it in browser settings.');
            stopMic();
        }
    };

    recognition.onresult = (event) => {
        const now = performance.now();

        // Count new words from the latest result
        const result = event.results[event.resultIndex];
        const transcript = result[0].transcript.trim();
        const words = transcript.split(/\s+/);

        // Record timestamps for rate calculation
        wordTimestamps.push({ time: now, count: words.length });

        // Keep only last 3 seconds of data
        const windowStart = now - 3000;
        wordTimestamps = wordTimestamps.filter(w => w.time > windowStart);

        // Calculate words per second over the window
        if (wordTimestamps.length >= 2) {
            const oldest = wordTimestamps[0];
            const elapsed = (now - oldest.time) / 1000;
            const totalWords = wordTimestamps.reduce((s, w) => s + w.count, 0);
            const wps = totalWords / Math.max(elapsed, 0.5);

            // Map WPS to speed multiplier
            // Typical speech: 2-3 words/sec → multiplier ~1.0
            // Fast speech: 4+ words/sec → multiplier ~1.5-2.0
            // Slow speech: 1 word/sec → multiplier ~0.5
            speechSpeed = Math.min(wps / 2.5, 2.5); // Normalize: 2.5 wps = 1.0x
        } else {
            speechSpeed = 0.8; // Default while starting
        }

        // Update status
        micStatusText.innerText = `Speaking — ${speechSpeed.toFixed(1)}× speed`;

        // Mark last speech time
        lastSpeechTime = now;

        // Reset silence timer
        clearTimeout(silenceTimeout);
        silenceTimeout = setTimeout(() => {
            speechSpeed = 0;
            micStatusText.innerText = 'Paused — waiting for speech';
        }, SILENCE_DELAY);
    };

    recognition.start();
}

function stopMic() {
    isMicActive = false;
    speechSpeed = 0;
    clearTimeout(silenceTimeout);
    if (recognition) {
        try { recognition.stop(); } catch (e) { }
    }
    micToggle.classList.remove('active');
    micStatusBar.classList.add('hidden');
}

// ============================================================
// SETTINGS PERSISTENCE
// ============================================================
function loadSettings() { } // Handled in init()

// ============================================================
init();
