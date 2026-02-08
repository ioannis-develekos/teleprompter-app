const editorContainer = document.getElementById('editor-container');
const prompterContainer = document.getElementById('prompter-container');
const textInput = document.getElementById('text-input');
const scrollContent = document.getElementById('scroll-content');
const startBtn = document.getElementById('start-btn');
const backBtn = document.getElementById('back-btn');
const controlsOverlay = document.getElementById('controls-overlay');
const tapZone = document.getElementById('tap-zone');

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
let scrollPos = 0;
let isPrompterActive = false;
let flipX = false;
let flipY = false;
let animationFrameId;

// Speech Tracking State
let recognition = null;
let isMicActive = false;
let scriptWordElements = []; // Array of span elements
let lastMatchedIndex = 0;
let silenceTimer;

// --- Initialization ---

function init() {
    loadSettings();
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

tapZone.addEventListener('click', () => {
    if (isMicActive) {
        // If Mic is active, tap just toggles controls overlay visibility?
        // Or maybe pauses mic? Let's assume tap pauses everything.
        toggleMic();
        return;
    }

    // Manual Mode
    isScrolling = !isScrolling;
    if (isScrolling) {
        controlsOverlay.classList.add('hidden');
        lastFrameTime = performance.now();
        requestAnimationFrame(gameLoop);
    } else {
        controlsOverlay.classList.remove('hidden');
    }
});

speedSlider.addEventListener('input', (e) => {
    scrollSpeed = parseInt(e.target.value);
    document.getElementById('speed-display').innerText = scrollSpeed;
});

sizeSlider.addEventListener('input', applySettings);
widthSlider.addEventListener('input', applySettings);
flipXBtn.addEventListener('click', () => { flipX = !flipX; applySettings(); });
flipYBtn.addEventListener('click', () => { flipY = !flipY; applySettings(); });
micToggle.addEventListener('click', toggleMic);

// --- Core Logic ---

function enterPrompterMode(text) {
    // 1. Prepare Text (Wrap words for tracking)
    prepareScriptForTracking(text);

    // 2. Switch View
    editorContainer.classList.remove('active');
    prompterContainer.classList.add('active');
    isPrompterActive = true;

    // 3. Reset State
    scrollPos = 0;
    scrollContent.style.top = '10px'; // Initial offset
    lastMatchedIndex = 0;
    isScrolling = false;

    applySettings();
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
    scrollContent.innerHTML = ''; // Clear
    scriptWordElements = [];

    // Split by paragraphs to preserve structure
    const paragraphs = text.split('\n');

    paragraphs.forEach(paraText => {
        if (!paraText.trim()) {
            scrollContent.appendChild(document.createElement('br'));
            return;
        }

        const p = document.createElement('div'); // Using div for lines/paragraphs
        p.style.marginBottom = '1em';

        // Split text into words, preserving spaces
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
            } else {
                p.appendChild(document.createTextNode(w));
            }
        });

        scrollContent.appendChild(p);
    });
}

function normalizeText(str) {
    return str.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Strip accents
        .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ""); // Strip punctuation
}

function applySettings() {
    scrollContent.style.fontSize = `${sizeSlider.value}px`;
    scrollContent.style.width = `${widthSlider.value}%`;

    scrollContent.className = ''; // reset classes
    if (flipX && flipY) scrollContent.classList.add('flip-xy');
    else if (flipX) scrollContent.classList.add('flip-x');
    else if (flipY) scrollContent.classList.add('flip-y');
}

// Manual Scroll Loop
function gameLoop(timestamp) {
    if (!isScrolling || !isPrompterActive || isMicActive) return; // Mic handles its own scroll

    const deltaTime = (timestamp - lastFrameTime) / 1000;
    lastFrameTime = timestamp;

    if (scrollSpeed > 0) {
        scrollPos += (scrollSpeed * 2) * deltaTime;
        window.scrollTo(0, scrollPos);
    }

    animationFrameId = requestAnimationFrame(gameLoop);
}

// --- Speech Recognition & Follow Mode ---

function toggleMic() {
    if (isMicActive) {
        stopMic();
    } else {
        startMic();
    }
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
        isScrolling = false; // Disable manual loop
        micToggle.classList.add('active');
        micToggle.innerText = '🎤 Listening...';
        controlsOverlay.classList.add('hidden'); // Hide controls for immersion
    };

    recognition.onend = () => {
        if (isMicActive) {
            try { recognition.start(); } catch (e) { } // Auto-restart
        } else {
            micToggle.classList.remove('active');
            micToggle.innerText = '🎤 Start Auto-Scroll';
        }
    };

    recognition.onresult = (event) => {
        // Collect latest interim or final results
        const results = event.results;
        const latestResult = results[event.resultIndex];
        const transcript = latestResult[0].transcript;

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

    // We only care about the last few spoken words to find our place
    // Look ahead from lastMatchedIndex
    const searchWindow = 50; // How far ahead to look
    const startSearch = lastMatchedIndex;
    const endSearch = Math.min(lastMatchedIndex + searchWindow, scriptWordElements.length);

    let bestMatchIndex = -1;

    // specific strategy: find the sequence of last 2-3 spoken words in the script window
    const lastWord = spokenWords[spokenWords.length - 1];
    if (!lastWord) return;

    // Simple single-word "anchor" matching for responsiveness
    // (A more complex version would match n-grams)
    for (let i = startSearch; i < endSearch; i++) {
        if (scriptWordElements[i].cleanText === lastWord) {
            bestMatchIndex = i;
            break; // Take the first match in the window
        }
    }

    if (bestMatchIndex !== -1) {
        lastMatchedIndex = bestMatchIndex;
        scrollToWord(bestMatchIndex);

        // Visual feedback
        const el = scriptWordElements[bestMatchIndex].element;
        el.style.color = '#ffff00'; // Highlight
        setTimeout(() => el.style.color = '', 1000); // Fade out
    }
}

function scrollToWord(index) {
    if (!scriptWordElements[index]) return;

    const el = scriptWordElements[index].element;

    // We want this element to be around the middle of the screen (or top third)
    // The "reading line" is usually around 30-40% from top.

    const rect = el.getBoundingClientRect();
    const absoluteTop = window.scrollY + rect.top;
    const targetScroll = absoluteTop - (window.innerHeight * 0.4); // 40% down

    // Smooth scroll
    window.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
    });
}
