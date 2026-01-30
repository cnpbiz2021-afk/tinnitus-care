/**
 * Tinnitus Care - Main Application
 * UI interactions and audio visualizer
 */

// Global audio engine instance
let audioEngine;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

/**
 * Initialize application
 */
function initializeApp() {
    // Create audio engine
    audioEngine = new TinnitusAudioEngine();

    // Setup event listeners
    setupFrequencyControls();
    setupVolumeControl();
    setupSoundSelection();
    setupVisualizer();
    setupBottomNav();

    // Setup auto-stop callback
    audioEngine.onAutoStop = () => {
        updateTherapyUI(false);
        alert('권장 치료 시간인 30분이 경과하여 치료를 자동으로 종료합니다. 수고하셨습니다!');
    };

    // Set initial sound selection
    selectSound('whitenoise');

    console.log('Tinnitus Care initialized');
}

/**
 * Setup bottom navigation for mobile
 */
function setupBottomNav() {
    const bottomNavItems = document.querySelectorAll('.bottom-nav-item');
    bottomNavItems.forEach(item => {
        item.addEventListener('click', (e) => {
            // Remove active from all
            bottomNavItems.forEach(i => i.classList.remove('active'));
            // Add to clicked
            item.classList.add('active');
        });
    });
}

/**
 * Setup frequency controls
 */
function setupFrequencyControls() {
    const slider = document.getElementById('frequencySlider');
    const display = document.getElementById('frequencyValue');

    slider.addEventListener('input', (e) => {
        const frequency = parseInt(e.target.value);
        updateFrequency(frequency);
    });

    // Initialize display
    updateFrequency(slider.value);
}

/**
 * Update frequency
 */
function updateFrequency(frequency) {
    const display = document.getElementById('frequencyValue');
    const slider = document.getElementById('frequencySlider');

    display.textContent = frequency;
    slider.value = frequency;

    if (audioEngine) {
        audioEngine.setFrequency(frequency);
    }
}

/**
 * Adjust frequency by delta
 */
function adjustFrequency(delta) {
    const slider = document.getElementById('frequencySlider');
    const currentFreq = parseInt(slider.value);
    const newFreq = Math.max(250, Math.min(16000, currentFreq + delta));
    updateFrequency(newFreq);
}

/**
 * Set preset frequency
 */
function setPreset(frequency, label) {
    updateFrequency(frequency);

    // Update active state
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.closest('.preset-btn').classList.add('active');
}

/**
 * Toggle test tone
 */
async function toggleTestTone() {
    const btn = document.getElementById('testToneBtn');
    const text = document.getElementById('testToneText');

    if (audioEngine.isTestTonePlaying) {
        audioEngine.stopTestTone();
        btn.classList.remove('playing');
        text.textContent = '테스트 톤 재생';
    } else {
        await audioEngine.playTestTone();
        btn.classList.add('playing');
        text.textContent = '테스트 톤 정지';
    }
}

/**
 * Setup volume control
 */
function setupVolumeControl() {
    const slider = document.getElementById('volumeSlider');
    const display = document.getElementById('volumeValue');

    slider.addEventListener('input', (e) => {
        const volume = parseInt(e.target.value) / 100;
        display.textContent = `${e.target.value}%`;

        if (audioEngine) {
            audioEngine.setVolume(volume);
        }
    });
}

/**
 * Setup sound selection
 */
function setupSoundSelection() {
    // Sound cards will be clicked via onclick in HTML
}

/**
 * Select sound type
 */
function selectSound(soundType) {
    audioEngine.currentSound = soundType;

    // Update active state
    document.querySelectorAll('.sound-card').forEach(card => {
        card.classList.remove('active');
    });
    event.target.closest('.sound-card').classList.add('active');

    // Update selected sound display
    const soundNames = {
        'whitenoise': '화이트 노이즈',
        'rain': '빗소리',
        'forest': '숲속 바람',
        'temple': '풍경 소리',
        'night': '밤 벌레 소리',
        'wave': '파도 소리'
    };

    document.getElementById('selectedSoundName').textContent = soundNames[soundType] || soundType;

    // IF therapy is already playing, update the sound in real-time
    if (audioEngine.isTherapyPlaying) {
        audioEngine.startTherapy(soundType, true);
    }
}

/**
 * Toggle therapy
 */
/**
 * Update therapy UI state
 */
function updateTherapyUI(isPlaying) {
    const btn = document.getElementById('therapyBtn');
    const icon = document.getElementById('therapyBtnIcon');
    const text = document.getElementById('therapyBtnText');

    if (isPlaying) {
        btn.classList.add('playing');
        icon.textContent = '⏸';
        text.textContent = '치료 중지';
    } else {
        btn.classList.remove('playing');
        icon.textContent = '▶';
        text.textContent = '치료 시작';
    }
}

/**
 * Toggle therapy
 */
async function toggleTherapy() {
    if (audioEngine.isTherapyPlaying) {
        audioEngine.stopTherapy();
        updateTherapyUI(false);
    } else {
        await audioEngine.startTherapy(audioEngine.currentSound);
        updateTherapyUI(true);
    }
}

/**
 * Setup audio visualizer
 */
function setupVisualizer() {
    const canvas = document.getElementById('visualizer');
    const ctx = canvas.getContext('2d');

    // Set canvas size
    const resizeCanvas = () => {
        const container = canvas.parentElement;
        canvas.width = container.clientWidth;
        canvas.height = 200;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Animation loop
    function draw() {
        requestAnimationFrame(draw);

        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas with a slight trail
        ctx.fillStyle = 'rgba(13, 40, 71, 0.2)';
        ctx.fillRect(0, 0, width, height);

        // Get analyser data
        const analyserData = audioEngine.getAnalyserData();

        if (analyserData && audioEngine.isTherapyPlaying) {
            const { bufferLength, dataArray } = analyserData;

            // Draw waveform
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#4A90E2';
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#4A90E2';
            ctx.beginPath();

            const sliceWidth = width / bufferLength;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = (v * height) / 2;

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }

                x += sliceWidth;
            }

            ctx.lineTo(width, height / 2);
            ctx.stroke();

            // Reset shadow
            ctx.shadowBlur = 0;

            // Draw frequency indicator
            drawFrequencyIndicator(ctx, width, height);
        } else {
            // Draw idle state
            drawIdleState(ctx, width, height);
        }
    }

    draw();
}

/**
 * Draw frequency indicator on visualizer
 */
function drawFrequencyIndicator(ctx, width, height) {
    const freq = audioEngine.currentFrequency;
    const minFreq = 250;
    const maxFreq = 16000;

    // Calculate position (logarithmic scale for better visualization)
    const minLog = Math.log10(minFreq);
    const maxLog = Math.log10(maxFreq);
    const freqLog = Math.log10(freq);
    const position = ((freqLog - minLog) / (maxLog - minLog)) * width;

    // Draw notch indicator
    ctx.fillStyle = 'rgba(231, 76, 60, 0.3)';
    ctx.fillRect(position - 20, 0, 40, height);

    // Draw center line
    ctx.strokeStyle = '#E74C3C';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(position, 0);
    ctx.lineTo(position, height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw label
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px Inter';
    ctx.textAlign = 'center';
    ctx.fillText(`${freq}Hz (Notched)`, position, 20);
}

/**
 * Draw idle state visualization
 */
function drawIdleState(ctx, width, height) {
    const time = Date.now() / 1000;

    ctx.strokeStyle = 'rgba(74, 144, 226, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let x = 0; x < width; x++) {
        const y = height / 2 + Math.sin((x / width) * Math.PI * 4 + time) * 20;

        if (x === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }

    ctx.stroke();

    // Draw message
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = '16px Noto Sans KR';
    ctx.textAlign = 'center';
    ctx.fillText('치료를 시작하려면 아래 버튼을 클릭하세요', width / 2, height / 2 + 60);
}

/**
 * Scroll to therapy section
 */
function scrollToTherapy() {
    document.getElementById('therapy').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Scroll to about section
 */
function scrollToAbout() {
    document.getElementById('about').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Update active nav link on scroll
 */
window.addEventListener('scroll', () => {
    const sections = ['home', 'therapy', 'about', 'guide'];
    const scrollPosition = window.scrollY + 100;

    sections.forEach(sectionId => {
        const section = document.getElementById(sectionId);
        if (section) {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.offsetHeight;

            if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
                // Update desktop nav
                document.querySelectorAll('.nav-link').forEach(link => {
                    link.classList.remove('active');
                    if (link.getAttribute('href') === `#${sectionId}`) {
                        link.classList.add('active');
                    }
                });

                // Update bottom nav
                document.querySelectorAll('.bottom-nav-item').forEach(item => {
                    item.classList.remove('active');
                    if (item.getAttribute('data-target') === sectionId) {
                        item.classList.add('active');
                    }
                });
            }
        }
    });
});

/**
 * Cleanup on page unload
 */
window.addEventListener('beforeunload', () => {
    if (audioEngine) {
        audioEngine.destroy();
    }
});

/**
 * Terms Modal Functions
 */
function openTerms() {
    document.getElementById('termsModal').style.display = 'block';
    document.body.style.overflow = 'hidden'; // Prevent scroll
}

function closeTerms() {
    document.getElementById('termsModal').style.display = 'none';
    document.body.style.overflow = 'auto'; // Restore scroll
}

// Close modal when clicking outside
window.onclick = function (event) {
    const modal = document.getElementById('termsModal');
    if (event.target == modal) {
        closeTerms();
    }
}
