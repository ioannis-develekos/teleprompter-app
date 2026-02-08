const editorContainer = document.getElementById('editor-container');
const prompterContainer = document.getElementById('prompter-container');
const textInput = document.getElementById('text-input');
const scrollContent = document.getElementById('scroll-content');
const startBtn = document.getElementById('start-btn');
const backBtn = document.getElementById('back-btn');
const controlsOverlay = document.getElementById('controls-overlay');
const tapZone = document.getElementById('tap-zone');

// Version Info
const APP_VERSION = "v1.2";

// Controls
const speedSlider = document.getElementById('speed-slider');
const sizeSlider = document.getElementById('size-slider');
const widthSlider = document.getElementById('width-slider');
const flipXBtn = document.getElementById('flip-x-btn');
const flipYBtn = document.getElementById('flip-y-btn');
const micToggle = document.getElementById('mic-toggle');
const languageSelect = document.getElementById('language-select');

// State
let isScrolling = false;
let scrollSpeed = 20; // Pixels per second
let lastFrameTime = 0;

// Transform State
let currentScrollPos = 0;
let targetScrollPos = 0;
const LERP_FACTOR = 0.1;

let isPrompterActive = false;
let flipX = false;
let flipY = false;
let animationFrameId;

// Touch State
let isDragging = false;
let lastTouchY = 0;

// Speech Tracking State
let recognition = null;
let isMicActive = false;
let scriptWordElements = [];
let lastMatchedIndex = 0;

// --- Initialization ---

function init() {
    loadSettings();
    document.title = `Teleprompter Pro ${APP_VERSION}`;

    // Add version badge if not exists
    const h1 = document.querySelector('header h1');
    if (h1 && !h1.querySelector('.version-badge')) {
        const badge = document.createElement('span');
        badge.className = 'version-badge';
        badge.innerText = APP_VERSION;
        h1.appendChild(badge);
    }

    const savedText = localStorage.getItem('teleprompter_text');
    if (savedText) {
        textInput.value = savedText;
    }
}

// --- Event Listeners ---

startBtn.addEventListener('click', () => {
    const text = textInput.value.trim();
    if (!text) return alert('Please enter some text!');
    localStorage.setItem('teleprompter_text', text);
    enterPrompterMode(text);
});

backBtn.addEventListener('click', exitPrompterMode);

// Tap Logic: Toggle Controls
tapZone.addEventListener('click', (e) => {
    // If we just dragged, don't toggle
    if (isDragging) return;

    // Toggle controls
    if (controlsOverlay.classList.contains('hidden')) {
        controlsOverlay.classList.remove('hidden');
        // Optionally pause?
    } else {
        controlsOverlay.classList.add('hidden');
    }

    // Toggle manual play/pause if NOT dragging and controls were hidden? 
    // User wants: "Ability to touch screen and toolbar appears" -> Implies tap for toolbar.
    // "Scroll manually with finger" -> Drag.

    // Let's separate Play/Pause from Menu Toggle.
    // Maybe: Tap = Toggle Menu.
    // Play Button in Menu? Or just Slider > 0?
    // Current behavior: Slider controls speed. 'isScrolling' is play state.

    if (!isMicActive) {
        // If controls match state... currently tap just toggles menu.
        // Let's keep scrolling running unless speed is 0.
        // Or if user wants to play/pause, maybe add a button?
        // User said: "Pause when I pause" (Speech).
        // Let's assume tap only toggles menu now, and drag handles manual move.
    }
});

// Touch Drag Logic
tapZone.addEventListener('touchstart', (e) => {
    isDragging = false;
    lastTouchY = e.touches[0].clientY;
    // Stop auto-scroll momentarily while touching?
    isScrolling = false;
}, { passive: false });

tapZone.addEventListener('touchmove', (e) => {
    isDragging = true;
    e.preventDefault(); // Stop Browser Scroll
    const touchY = e.touches[0].clientY;
    const deltaY = lastTouchY - touchY; // Up is positive delta (scrolling down)

    // Directly move content
    targetScrollPos += deltaY;
    if (targetScrollPos < 0) targetScrollPos = 0;

    // Instant update for responsiveness
    currentScrollPos = targetScrollPos;
    updateScrollTransform();

    lastTouchY = touchY;
}, { passive: false });

tapZone.addEventListener('touchend', () => {
    // Resume scrolling if it was active?
    // Or just leave it paused?
    // User expectation: If I drag, I take control.
    // If I let go, maybe it stays there until I hit 'play' or speak?
    // Let's leave isScrolling = false for manual control.
    // User can tap controls -> Speed -> Auto scroll? 
    // Wait, if manual mode, how to resume?
    // Maybe we need a specific toggle for "Auto Scroll" vs "Manual".
    // For now: Speed slider > 0 implies auto movement. 
    // If user dragged, we paused. To resume, maybe tap? 

    // Let's auto-resume if NOT mic mode, after short delay?
    // Or just let user tap to resume?
    // Simplified: Drag pauses. Tap toggles Menu. 
    // If Menu hidden, maybe Tap toggles Play/Pause?
});


speedSlider.addEventListener('input', (e) => {
    scrollSpeed = parseInt(e.target.value);
    document.getElementById('speed-display').innerText = scrollSpeed;
    if (scrollSpeed > 0 && !isMicActive) isScrolling = true;
});

sizeSlider.addEventListener('input', applySettings);
widthSlider.addEventListener('input', applySettings);
flipXBtn.addEventListener('click', () => { flipX = !flipX; applySettings(); });
flipYBtn.addEventListener('click', () => { flipY = !flipY; applySettings(); });
micToggle.addEventListener('click', toggleMic);

// --- Core Logic ---

function enterPrompterMode(text) {
    prepareScriptForTracking(text);

    editorContainer.classList.remove('active');
    prompterContainer.classList.add('active');
    isPrompterActive = true;

    // Reset
    currentScrollPos = 0;
    targetScrollPos = 0;
    updateScrollTransform();

    isScrolling = false;
    applySettings();

    lastFrameTime = performance.now();
    requestAnimationFrame(gameLoop);
}

function exitPrompterMode() {
    isPrompterActive = false;
    isScrolling = false;
    stopMic();
    cancelAnimationFrame(animationFrameId);

    prompterContainer.classList.remove('active');
    editorContainer.classList.add('active');
}

function prepareScriptForTracking(text) {
    scrollContent.innerHTML = '';
    scriptWordElements = [];

    const paragraphs = text.split('\n');
    paragraphs.forEach(paraText => {
        if (!paraText.trim()) {
            scrollContent.appendChild(document.createElement('br'));
            return;
        }
        const p = document.createElement('div');
        p.style.marginBottom = '1em';
        const words = paraText.split(/(\s+)/);
        words.forEach(w => {
            if (w.trim().length > 0) {
                const span = document.createElement('span');
                span.innerText = w;
                span.className = 'script-word';
                p.appendChild(span);
                scriptWordElements.push({
                    element: span,
                    cleanText: normalizeText(w)
                });
            } else { p.appendChild(document.createTextNode(w)); }
        });
        scrollContent.appendChild(p);
    });
}

function normalizeText(str) {
    return str.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");
}

function applySettings() {
    scrollContent.style.fontSize = `${sizeSlider.value}px`;
    scrollContent.style.width = `${widthSlider.value}%`;
    updateScrollTransform(); // Re-apply in case of flip change
}

// Update the visual transform
function updateScrollTransform() {
    // Top: 50vh is usually base.
    // If we want to scroll "UP", we TranslateY negative.
    // translate3d(0, calc(50vh - currentScrollPos px), 0)
    // But CSS calc in transform is tricky with variables in JS strings.
    // Let's just use pixel offset from specific top.

    // We want the text to start at 50vh (middle).
    // So visual Y = (50vh in px) - currentScrollPos
    // We can just keep top: 50vh in CSS and translate -currentScrollPos

    let transform = `translateX(-50%) translate3d(0, -${currentScrollPos}px, 0)`;

    if (flipX && flipY) transform += ' scale(-1, -1)';
    else if (flipX) transform += ' scaleX(-1)';
    else if (flipY) transform += ' scaleY(-1)';

    scrollContent.style.transform = transform;
}

function gameLoop(timestamp) {
    if (!isPrompterActive) return;

    const deltaTime = (timestamp - lastFrameTime) / 1000;
    lastFrameTime = timestamp;

    if (isScrolling && !isMicActive && scrollSpeed > 0 && !isDragging) {
        targetScrollPos += (scrollSpeed * 2) * deltaTime;
    }

    // Lerp for smoothness
    if (!isDragging) {
        if (Math.abs(targetScrollPos - currentScrollPos) > 0.5) {
            currentScrollPos += (targetScrollPos - currentScrollPos) * LERP_FACTOR;
            updateScrollTransform();
        } else {
            // Snap
            if (currentScrollPos !== targetScrollPos) {
                currentScrollPos = targetScrollPos;
                updateScrollTransform();
            }
        }
    }

    animationFrameId = requestAnimationFrame(gameLoop);
}

// --- Speech Recognition ---

function toggleMic() {
    if (isMicActive) stopMic();
    else startMic();
}

function startMic() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert('Browser not supported.');

    recognition = new SpeechRecognition();
    recognition.lang = languageSelect.value;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        isMicActive = true;
        isScrolling = false;
        micToggle.classList.add('active');
        micToggle.innerText = '🎤 Listening...';
        controlsOverlay.classList.add('hidden');
    };

    recognition.onend = () => {
        if (isMicActive) {
            try { recognition.start(); } catch (e) { }
        } else {
            micToggle.classList.remove('active');
            micToggle.innerText = '🎤 Start Auto-Scroll';
        }
    };

    recognition.onresult = (event) => {
        const results = event.results;
        const transcript = results[event.resultIndex][0].transcript;
        matchSpeechToScript(transcript);
    };

    recognition.start();
}

function stopMic() {
    isMicActive = false;
    if (recognition) recognition.stop();
    controlsOverlay.classList.remove('hidden');
}

function matchSpeechToScript(transcript) {
    const spokenWords = normalizeText(transcript).split(/\s+/);
    if (spokenWords.length === 0) return;

    const searchWindow = 60;
    const startSearch = lastMatchedIndex;
    const endSearch = Math.min(lastMatchedIndex + searchWindow, scriptWordElements.length);

    let bestMatchIndex = -1;
    const lastWord = spokenWords[spokenWords.length - 1];
    if (!lastWord) return;

    for (let i = startSearch; i < endSearch; i++) {
        if (scriptWordElements[i].cleanText === lastWord) {
            bestMatchIndex = i;
            break;
        }
    }

    if (bestMatchIndex !== -1) {
        lastMatchedIndex = bestMatchIndex;
        scrollToWord(bestMatchIndex);

        const el = scriptWordElements[bestMatchIndex].element;
        el.style.color = '#ffff00';
        setTimeout(() => el.style.color = '', 1000);
    }
}

function scrollToWord(index) {
    if (!scriptWordElements[index]) return;
    const el = scriptWordElements[index].element;

    // Find offset relative to container
    // Since we use transform on scrollContent, el.offsetTop is internal to that container
    // offsetTop = distance from top of scrollContent (which starts at 0 inside itself)

    const offsetTop = el.offsetTop;

    // We want this word to be at 40% of viewport.
    // Visual Top = scrollContent.top (50vh) - scrollPos + offsetTop
    // We want Visual Top = 40vh
    // 40vh = 50vh - scrollPos + offsetTop
    // scrollPos = 50vh - 40vh + offsetTop
    // scrollPos = 10vh + offsetTop

    const vh = window.innerHeight;
    const targetVisualY = vh * 0.4;
    const startY = vh * 0.5; // CSS top: 50vh

    // targetVisualY = startY - scrollPos + offsetTop
    // scrollPos = startY - targetVisualY + offsetTop
    // scrollPos = (0.5 - 0.4)*vh + offsetTop = 0.1*vh + offsetTop

    targetScrollPos = (vh * 0.1) + offsetTop;

    // Safety
    if (targetScrollPos < 0) targetScrollPos = 0;
}

init();
