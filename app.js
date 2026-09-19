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
    setupAudioAnalysis();

    // Handy for browser-console verification: audioEngine.measureLive(), TinnitusAudioEngine.runSelfTest(...)
    window.audioEngine = audioEngine;

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

    frequency = Number(frequency);
    display.textContent = frequency;
    slider.value = frequency;

    if (audioEngine) {
        audioEngine.setFrequency(frequency);
        updateAnalysisPanel();
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
    const target = window.event && window.event.target && window.event.target.closest
        ? window.event.target.closest('.preset-btn') : null;
    if (target) target.classList.add('active');
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

    // Update active state (works for clicks and for the initial programmatic call)
    document.querySelectorAll('.sound-card').forEach(card => {
        card.classList.remove('active');
    });
    const clicked = window.event && window.event.target && window.event.target.closest
        ? window.event.target.closest('.sound-card') : null;
    const activeCard = clicked || Array.from(document.querySelectorAll('.sound-card'))
        .find(card => (card.getAttribute('onclick') || '').includes(`'${soundType}'`));
    if (activeCard) activeCard.classList.add('active');

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
        audioEngine.switchSound(soundType);
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
 * Shows the ACTUAL output spectrum (analyser FFT after the notch filter) on a
 * logarithmic frequency axis, with the pre-notch spectrum as a faint dashed
 * line and the notch band marked at the tinnitus frequency.
 */
const VIS_MIN_HZ = 250;
const VIS_MAX_HZ = 16000;
const visState = { yMax: null, binCache: null };

function setupVisualizer() {
    const canvas = document.getElementById('visualizer');
    const ctx = canvas.getContext('2d');

    // Set canvas size
    const resizeCanvas = () => {
        const container = canvas.parentElement;
        canvas.width = container.clientWidth;
        canvas.height = 200;
        visState.binCache = null;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Animation loop
    function draw() {
        requestAnimationFrame(draw);

        const width = canvas.width;
        const height = canvas.height;

        if (audioEngine.isTherapyPlaying) {
            const spec = audioEngine.getSpectrumData();
            if (spec) {
                // Opaque clear: a spectrum should not leave motion trails
                ctx.fillStyle = '#0D2847';
                ctx.fillRect(0, 0, width, height);
                drawSpectrum(ctx, width, height, spec);
                drawFrequencyIndicator(ctx, width, height);
                return;
            }
        }

        // Clear canvas with a slight trail (idle animation)
        ctx.fillStyle = 'rgba(13, 40, 71, 0.2)';
        ctx.fillRect(0, 0, width, height);
        drawIdleState(ctx, width, height);
    }

    draw();
}

/** x position (px) of a frequency on the log axis */
function freqToX(freq, width) {
    const minLog = Math.log10(VIS_MIN_HZ);
    const maxLog = Math.log10(VIS_MAX_HZ);
    return ((Math.log10(freq) - minLog) / (maxLog - minLog)) * width;
}

/** Pre-compute FFT-bin ranges for each drawn column (log frequency mapping) */
function getBinCache(width, sampleRate, fftSize) {
    const c = visState.binCache;
    if (c && c.width === width && c.sampleRate === sampleRate && c.fftSize === fftSize) return c;
    const step = 2;
    const binHz = sampleRate / fftSize;
    const cols = [];
    for (let x = 0; x <= width; x += step) {
        const f0 = VIS_MIN_HZ * Math.pow(VIS_MAX_HZ / VIS_MIN_HZ, x / width);
        const f1 = VIS_MIN_HZ * Math.pow(VIS_MAX_HZ / VIS_MIN_HZ, Math.min(x + step, width) / width);
        const lo = Math.max(1, Math.floor(f0 / binHz));
        const hi = Math.max(lo, Math.min(fftSize / 2 - 1, Math.ceil(f1 / binHz)));
        cols.push({ x, lo, hi });
    }
    visState.binCache = { width, sampleRate, fftSize, cols };
    return visState.binCache;
}

/** Power-mean level (dB) per column */
function columnLevels(db, cache) {
    const out = new Float32Array(cache.cols.length);
    for (let i = 0; i < cache.cols.length; i++) {
        const { lo, hi } = cache.cols[i];
        let sum = 0;
        for (let k = lo; k <= hi; k++) sum += Math.pow(10, db[k] / 10);
        out[i] = 10 * Math.log10(sum / (hi - lo + 1) + 1e-30);
    }
    return out;
}

/**
 * Draw output spectrum (after notch) + pre-notch reference
 */
function drawSpectrum(ctx, width, height, spec) {
    const cache = getBinCache(width, spec.sampleRate, spec.fftSize);
    const post = columnLevels(spec.postDb, cache);
    const pre = columnLevels(spec.preDb, cache);

    // Auto range: top = loudest pre-notch column (smoothed), 60 dB of range
    let peak = -200;
    for (let i = 0; i < pre.length; i++) peak = Math.max(peak, pre[i]);
    if (peak > -150) {
        visState.yMax = visState.yMax === null ? peak + 4 : visState.yMax * 0.95 + (peak + 4) * 0.05;
    }
    const yMax = visState.yMax === null ? -20 : visState.yMax;
    const range = 60;
    const top = 26, bottom = height - 38;
    const levelToY = (l) => {
        const t = Math.min(1, Math.max(0, (l - (yMax - range)) / range));
        return bottom - t * (bottom - top);
    };

    // Frequency axis ticks
    ctx.font = '11px Inter';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    [500, 1000, 2000, 4000, 8000].forEach(f => {
        const x = Math.round(freqToX(f, width)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x, height - 22);
    });

    // Notch band (from the actual bandwidth setting)
    const f = audioEngine.tinnitusFrequency;
    const bw = audioEngine.notchBandwidthOctaves;
    const x1 = freqToX(f * Math.pow(2, -bw / 2), width);
    const x2 = freqToX(f * Math.pow(2, bw / 2), width);
    ctx.fillStyle = 'rgba(231, 76, 60, 0.18)';
    ctx.fillRect(x1, top, Math.max(2, x2 - x1), bottom - top);

    // Pre-notch spectrum (reference, dashed)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    cache.cols.forEach((c, i) => {
        const y = levelToY(pre[i]);
        if (i === 0) ctx.moveTo(c.x, y); else ctx.lineTo(c.x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Post-notch spectrum (actual output): filled area + glowing line
    ctx.beginPath();
    cache.cols.forEach((c, i) => {
        const y = levelToY(post[i]);
        if (i === 0) ctx.moveTo(c.x, y); else ctx.lineTo(c.x, y);
    });
    ctx.lineTo(width, bottom);
    ctx.lineTo(0, bottom);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, 'rgba(74, 144, 226, 0.45)');
    grad.addColorStop(1, 'rgba(74, 144, 226, 0.05)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4A90E2';
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#4A90E2';
    ctx.beginPath();
    cache.cols.forEach((c, i) => {
        const y = levelToY(post[i]);
        if (i === 0) ctx.moveTo(c.x, y); else ctx.lineTo(c.x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Legend
    ctx.textAlign = 'left';
    ctx.font = '11px Noto Sans KR';
    ctx.fillStyle = '#4A90E2';
    ctx.fillText('━ 실제 출력 스펙트럼 (노치 후)', 8, height - 6);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillText('┅ 노치 전', 8 + 170, height - 6);
}

/**
 * Draw frequency indicator on visualizer (same log axis as the spectrum)
 */
function drawFrequencyIndicator(ctx, width, height) {
    const freq = audioEngine.currentFrequency;
    const position = freqToX(freq, width);

    // Draw center line
    ctx.strokeStyle = '#E74C3C';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(position, 0);
    ctx.lineTo(position, height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw label (kept inside the canvas)
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px Inter';
    const label = `${freq}Hz (Notched)`;
    const half = ctx.measureText(label).width / 2 + 4;
    ctx.textAlign = 'center';
    ctx.fillText(label, Math.min(Math.max(position, half), width - half), 18);
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
 * ===== Audio analysis / verification panel =====
 * Everything shown here is read back from the real Web Audio nodes:
 * AudioParam values, the BiquadFilterNode frequency response, and the
 * AnalyserNode FFT of the actual output.
 */
function fmtDb(v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return `${v.toFixed(1)} dB`;
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setupAudioAnalysis() {
    const select = document.getElementById('aaBandwidth');
    if (select) {
        select.value = String(audioEngine.notchBandwidthOctaves);
        select.addEventListener('change', (e) => {
            audioEngine.setNotchBandwidth(parseFloat(e.target.value));
            updateAnalysisPanel();
        });
    }
    updateAnalysisPanel();
    setInterval(() => {
        const panel = document.getElementById('audioAnalysis');
        if (panel && panel.open) updateAnalysisPanel();
    }, 250);
}

function updateAnalysisPanel() {
    const panel = document.getElementById('audioAnalysis');
    if (!panel || !audioEngine || !audioEngine.notchFilters.length) return;
    if (!panel.open) return;

    const st = audioEngine.getNotchState();
    setText('aaFreq', `${audioEngine.tinnitusFrequency} Hz`);
    setText('aaCentre', `${st.centreParamHz.toFixed(1)} Hz`);
    setText('aaQ', `${st.notchQEquivalent.toFixed(2)} (단계당 ${st.qPerStage.toFixed(2)} × ${st.stages})`);
    setText('aaBw', `${st.measuredBandwidthOct.toFixed(2)} oct`);

    const chain = audioEngine.verifySignalChain();
    const chainEl = document.getElementById('aaChain');
    if (chainEl) {
        chainEl.textContent = chain.ok
            ? `${chain.path.join(' → ')}  ✓ 연결 확인 (활성 소스 ${chain.liveVoices}, 페이드 중 ${chain.aliveVoices - chain.liveVoices})`
            : `⚠ 연결 오류: ${chain.errors.join('; ')}`;
        chainEl.classList.toggle('aa-bad', !chain.ok);
    }

    const badge = document.getElementById('aaBadge');
    const m = audioEngine.isTherapyPlaying ? audioEngine.measureLive() : null;
    if (!m || m.silent) {
        setText('aaPre', '—');
        setText('aaPost', '—');
        setText('aaAtten', '치료 재생 중 측정');
        setText('aaDip', '—');
        if (badge) { badge.textContent = '대기'; badge.dataset.state = 'idle'; }
        return;
    }
    setText('aaPre', fmtDb(m.preDb));
    setText('aaPost', fmtDb(m.postDb));
    setText('aaAtten', fmtDb(m.attenuationDb));
    setText('aaDip', fmtDb(m.dipVsShouldersDb));
    if (badge) {
        const ok = m.attenuationDb >= 20;
        badge.textContent = ok ? `노치 ${m.attenuationDb.toFixed(0)} dB 확인` : '노치 약함';
        badge.dataset.state = ok ? 'ok' : 'warn';
    }
}

/**
 * Offline self-test: renders the real engine graph in an OfflineAudioContext
 * (same notch chain, same code path) and compares FFT levels before / after.
 */
async function runNotchSelfTest(allSounds) {
    const out = document.getElementById('aaResult');
    const buttons = document.querySelectorAll('.aa-btn');
    buttons.forEach(b => b.disabled = true);
    out.textContent = '측정 중...';

    const sounds = allSounds ? Object.keys(TINNITUS_SOUND_PROFILES) : [audioEngine.currentSound];
    const rows = [];
    try {
        for (const sound of sounds) {
            await new Promise(r => setTimeout(r, 0));   // keep the UI responsive between renders
            const r = await TinnitusAudioEngine.runSelfTest({
                sound,
                frequency: audioEngine.tinnitusFrequency,
                bandwidthOctaves: audioEngine.notchBandwidthOctaves,
                stages: audioEngine.notchStages,
                sampleRate: audioEngine.audioContext.sampleRate
            });
            rows.push(r);
        }
    } catch (err) {
        out.textContent = `검증 실패: ${err.message}`;
        buttons.forEach(b => b.disabled = false);
        return;
    }

    const table = document.createElement('table');
    table.className = 'aa-table';
    const head = table.createTHead().insertRow();
    ['사운드', '노치 전', '노치 후', '감쇠', '판정'].forEach(t => {
        const th = document.createElement('th');
        th.textContent = t;
        head.appendChild(th);
    });
    const body = table.createTBody();
    rows.forEach(r => {
        const tr = body.insertRow();
        const cells = [
            TINNITUS_SOUND_PROFILES[r.sound].label,
            fmtDb(r.preDb), fmtDb(r.postDb), fmtDb(r.attenuationDb),
            r.pass ? '✓ 통과' : '✗ 확인 필요'
        ];
        cells.forEach((t, i) => {
            const td = tr.insertCell();
            td.textContent = t;
            if (i === 4) td.className = r.pass ? 'aa-pass' : 'aa-fail';
        });
    });
    out.textContent = '';
    const cap = document.createElement('div');
    cap.className = 'aa-caption';
    cap.textContent = `${audioEngine.tinnitusFrequency} Hz 기준 · FFT ${rows[0].sampleRate} Hz 오프라인 렌더 · 판정 기준(개발용): 감쇠 20 dB 이상 + 해당 주파수에 충분한 에너지`;
    out.appendChild(cap);
    out.appendChild(table);
    buttons.forEach(b => b.disabled = false);
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
