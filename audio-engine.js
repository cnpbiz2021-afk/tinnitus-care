/**
 * Tinnitus Care - Audio Engine
 * Web Audio API based Notched Sound Therapy Implementation
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  SIGNAL CHAIN (persistent nodes are created once and never rebuilt)
 *
 *   Voice (one per active sound, cross-faded on switch)
 *     ├─ BufferSource ─ Shaping (Biquad) ─ CharacterGain ─┐
 *     └─ BedSource ─ BedGain ─────────────────────────────┴─ VoiceGain
 *                                                              │
 *   SoundBus*  (mix point; everything the user hears passes here)
 *     │   └── (side tap) PreNotchAnalyser* ─ SilentSink* ─ destination
 *     ▼
 *   NotchFilter[0..N-1]*   BiquadFilterNode type="notch", cascaded
 *     ▼
 *   TherapyGain*  →  Analyser*  →  MasterGain*  →  destination
 *
 *  - The notch filter nodes are NEVER recreated. Only their AudioParams
 *    (frequency / Q) are changed, smoothly, via setTargetAtTime().
 *  - Sound switching only creates / retires a Voice. Retired voices are
 *    faded out, stopped, disconnected and released (no node accumulation).
 *  - Every connection is recorded in an app-level registry, because
 *    AudioNode has no standard "connected" property.
 *
 *  NOTCH PARAMETERS (kept separate so they are easy to tune later)
 *    tinnitusFrequency      – user-set frequency in Hz (= notch centre)
 *    notchBandwidthOctaves  – target −3 dB bandwidth of the whole notch
 *    notchQ                 – equivalent single-biquad Q derived from the
 *                             bandwidth (or set directly via setNotchQ)
 *    notchStages            – number of cascaded biquad notches (depth/skirt)
 *  These are engineering defaults chosen for audible, measurable behaviour.
 *  They are NOT presented as clinically validated treatment values.
 * ─────────────────────────────────────────────────────────────────────────
 */

/* ========================================================================
 * Spectrum helpers (FFT / Welch PSD / band levels) – used by self-test and
 * by the live analyser measurement.
 * ====================================================================== */
const TinnitusSpectrumTools = {
    /** In-place radix-2 FFT. re/im are Float64Array of power-of-two length. */
    fft(re, im) {
        const n = re.length;
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                let t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
            }
        }
        for (let len = 2; len <= n; len <<= 1) {
            const ang = -2 * Math.PI / len;
            const wr = Math.cos(ang), wi = Math.sin(ang);
            const half = len >> 1;
            for (let i = 0; i < n; i += len) {
                let cr = 1, ci = 0;
                for (let k = 0; k < half; k++) {
                    const a = i + k, b = a + half;
                    const vr = re[b] * cr - im[b] * ci;
                    const vi = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - vr; im[b] = im[a] - vi;
                    re[a] += vr; im[a] += vi;
                    const t = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = t;
                }
            }
        }
    },

    /** Welch-averaged power spectral density (Hann window, 50% overlap). */
    welchPsd(samples, N = 16384) {
        const win = new Float64Array(N);
        let ws = 0;
        for (let i = 0; i < N; i++) {
            win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
            ws += win[i] * win[i];
        }
        const psd = new Float64Array(N / 2);
        let segments = 0;
        for (let s = 0; s + N <= samples.length; s += N / 2) {
            const re = new Float64Array(N), im = new Float64Array(N);
            for (let i = 0; i < N; i++) re[i] = samples[s + i] * win[i];
            this.fft(re, im);
            for (let k = 0; k < N / 2; k++) psd[k] += (re[k] * re[k] + im[k] * im[k]) / ws;
            segments++;
        }
        if (segments === 0) return psd;
        for (let k = 0; k < psd.length; k++) psd[k] /= segments;
        return psd;
    },

    /** Convert an analyser dB array (getFloatFrequencyData) to linear power. */
    dbToPower(db) {
        const p = new Float64Array(db.length);
        for (let i = 0; i < db.length; i++) p[i] = Number.isFinite(db[i]) ? Math.pow(10, db[i] / 10) : 0;
        return p;
    },

    /**
     * Mean power (in dB) of a linear-power spectrum between lowHz and highHz.
     * `power` has fftSize/2 (or frequencyBinCount) bins spaced sampleRate/fftSize.
     */
    rangeLevelDb(power, sampleRate, fftSize, lowHz, highHz) {
        const binHz = sampleRate / fftSize;
        const a = Math.max(1, Math.floor(lowHz / binHz));
        let b = Math.min(power.length - 1, Math.ceil(highHz / binHz));
        if (b < a) b = a;
        let sum = 0;
        for (let k = a; k <= b; k++) sum += power[k];
        return 10 * Math.log10(sum / (b - a + 1) + 1e-30);
    },

    /** Level around centre f, `widthOct` octaves wide (at least ±2 bins). */
    bandLevelDb(power, sampleRate, fftSize, f, widthOct = 1 / 12) {
        const binHz = sampleRate / fftSize;
        const halfHz = Math.max(f * (Math.pow(2, widthOct / 2) - 1), 2 * binHz);
        return this.rangeLevelDb(power, sampleRate, fftSize, f - halfHz, f + halfHz);
    },

    /**
     * How deep is the dip at f compared with its spectral neighbours?
     * shoulders = 0.7–1.3 octaves on each side of f (clipped to the valid range).
     * Returns shoulderMean − centre (positive number = dip depth in dB).
     */
    dipVsShouldersDb(power, sampleRate, fftSize, f, centreWidthOct = 1 / 12) {
        const nyq = sampleRate / 2;
        const centre = this.bandLevelDb(power, sampleRate, fftSize, f, centreWidthOct);
        const edges = [
            [f * Math.pow(2, -1.3), f * Math.pow(2, -0.7)],
            [f * Math.pow(2, 0.7), f * Math.pow(2, 1.3)]
        ];
        const levels = [];
        edges.forEach(([lo, hi]) => {
            if (lo >= 50 && hi <= nyq * 0.95) levels.push(this.rangeLevelDb(power, sampleRate, fftSize, lo, hi));
        });
        if (!levels.length) return null;
        const meanPow = levels.reduce((s, l) => s + Math.pow(10, l / 10), 0) / levels.length;
        return 10 * Math.log10(meanPow) - centre;
    },

    /** 1/3-octave centre frequencies between lowHz and highHz. */
    thirdOctaveCentres(lowHz = 250, highHz = 12000) {
        const out = [];
        for (let f = lowHz; f <= highHz * 1.0001; f *= Math.pow(2, 1 / 3)) out.push(f);
        return out;
    }
};

/* ========================================================================
 * Small deterministic PRNG (used only when a seed is supplied, e.g. in the
 * self-test so the "before" and "after" renders contain the *same* noise).
 * ====================================================================== */
function tinnitusMulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function tinnitusHashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/* ========================================================================
 * Per-sound profiles
 *
 * Problem in the previous version: hard low/high/band-pass "shaping" filters
 * (e.g. low-pass 350 Hz for the ocean) removed nearly all energy around
 * typical tinnitus frequencies, so a notch there had nothing to remove.
 *
 * Fix (methods A + C):
 *   A) shaping uses shelving / peaking filters that colour the sound but
 *      never wipe out a whole region of the 250–12000 Hz range;
 *   C) the ocean buffer itself now contains swell-locked broadband surf hiss,
 *      so its spectrum reaches the top of the range naturally.
 *
 *  makeup : linear level trim so sounds keep roughly the loudness they had
 *  bed    : optional { source:'pink'|'white', level (linear) }. Measured to be
 *           unnecessary with the relaxed shaping, so it is off by default, but
 *           the mechanism is kept for future tuning.
 * ====================================================================== */
const TINNITUS_SOUND_PROFILES = {
    whitenoise: {
        label: '화이트 노이즈',
        bufferSeconds: 4,
        shaping: null,
        makeup: 0.5,            // peak-safe: notched white noise reaches ~3.2×RMS
        bed: null
    },
    rain: {
        label: '빗소리',
        bufferSeconds: 4,
        shaping: { type: 'highpass', frequency: 400, Q: 0.7 },   // was 700 Hz
        makeup: 0.85,
        bed: null
    },
    wave: {
        label: '파도 소리',
        bufferSeconds: 6,
        // was low-pass 350 Hz (≈ no energy above 1 kHz). Now a gentle high shelf
        // + swell-locked surf hiss generated inside the buffer.
        shaping: { type: 'highshelf', frequency: 1500, gain: -8 },
        makeup: 0.645,
        bed: null
    },
    forest: {
        label: '숲속 바람',
        bufferSeconds: 4,
        // was band-pass 1200 Hz Q0.6; now a mid emphasis that keeps the rest
        shaping: { type: 'peaking', frequency: 1200, Q: 0.6, gain: 6 },
        makeup: 0.535,
        bed: null
    },
    night: {
        label: '밤 벌레 소리',
        bufferSeconds: 3,
        // was high-pass 1500 Hz; now a high shelf so lows are not deleted
        shaping: { type: 'highshelf', frequency: 1500, gain: 8 },
        makeup: 0.29,
        bed: null
    },
    temple: {
        label: '풍경 소리',
        bufferSeconds: 4,
        // was low-pass 900 Hz (≈ −67 dB at 6 kHz); now a high shelf cut
        shaping: { type: 'highshelf', frequency: 900, gain: -10 },
        makeup: 0.76,
        bed: null
    }
};

class TinnitusAudioEngine {
    /**
     * @param {Object} [options]
     * @param {BaseAudioContext} [options.audioContext]  inject a context (used by the offline self-test)
     * @param {boolean} [options.enableTimer=true]
     * @param {number}  [options.seed]                   deterministic noise (self-test only)
     * @param {boolean} [options.notchEnabled=true]      false → notch stages become allpass (self-test "before" render)
     * @param {number}  [options.tinnitusFrequency=4000]
     * @param {number}  [options.notchBandwidthOctaves=0.5]
     * @param {number}  [options.notchStages=2]
     */
    constructor(options = {}) {
        this.audioContext = options.audioContext || null;
        this.isOffline = !!(this.audioContext && typeof this.audioContext.startRendering === 'function');
        this.enableTimer = options.enableTimer !== false && !this.isOffline;
        this._seed = (options.seed === undefined || options.seed === null) ? null : options.seed;
        this.notchEnabled = options.notchEnabled !== false;

        // ── Notch parameters (separated on purpose – see header) ──────────
        this.tinnitusFrequency = Number(options.tinnitusFrequency) || 4000;
        this.notchBandwidthOctaves = options.notchBandwidthOctaves || 0.5;
        this.notchStages = Math.max(1, Math.min(4, options.notchStages || 2));
        this.minFrequency = 20;                 // engine clamp (Hz)
        this.frequencyTimeConstant = 0.02;      // setTargetAtTime τ (s) for frequency/Q moves
        this.soundFadeSeconds = 0.12;           // cross-fade / fade in-out (s)
        this.maxVoices = 3;                     // hard cap on simultaneously alive voices

        // Persistent nodes
        this.masterGain = null;
        this.analyser = null;
        this.preAnalyser = null;
        this.soundBus = null;
        this.notchFilters = [];
        this.therapyGain = null;
        this._silentSink = null;

        // Test tone
        this.testOscillator = null;
        this.testGain = null;

        // Voices (active + fading)
        this._voices = [];
        this._voiceSeq = 0;

        // Buffer caches (generated lazily, once per sound)
        this._soundBuffers = new Map();
        this._noiseBuffers = new Map();

        // Explicit connection registry (AudioNode has no `connected` property)
        this._nodeNames = new Map();
        this._edges = new Set();

        // State
        this.isTestTonePlaying = false;
        this.isTherapyPlaying = false;
        this.currentVolume = 0.5;
        this.currentSound = 'whitenoise';

        // Timer
        this.therapyStartTime = null;
        this.therapyDuration = 0;
        this.timerInterval = null;
        this.onAutoStop = null;
        this.maxDuration = 1800; // 30 minutes in seconds

        this._postDb = null;
        this._preDb = null;

        this.initAudioContext();
    }

    /** Backwards compatible alias used by app.js */
    get currentFrequency() { return this.tinnitusFrequency; }
    set currentFrequency(v) { this.tinnitusFrequency = Number(v) || this.tinnitusFrequency; }

    /* ─────────────────────────── graph construction ─────────────────── */

    /**
     * Initialize Web Audio API context and build the persistent graph.
     */
    initAudioContext() {
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            const ctx = this.audioContext;

            // Master gain (user volume) → destination
            this.masterGain = ctx.createGain();
            this.masterGain.gain.value = this.currentVolume;
            this._register(this.masterGain, 'MasterGain');
            this._register(ctx.destination, 'Output');
            this._link(this.masterGain, ctx.destination);

            // Analyser (post-notch, post-therapy-gain) → master
            this.analyser = this._createAnalyser();
            this._register(this.analyser, 'Analyser');
            this._link(this.analyser, this.masterGain);

            // Therapy gain → analyser
            this.therapyGain = ctx.createGain();
            this.therapyGain.gain.value = 1;
            this._register(this.therapyGain, 'TherapyGain');
            this._link(this.therapyGain, this.analyser);

            // Notch filter cascade → therapy gain
            this.notchFilters = [];
            const initialQ = this._stageQ(this.tinnitusFrequency);
            for (let i = 0; i < this.notchStages; i++) {
                const f = ctx.createBiquadFilter();
                f.type = this.notchEnabled ? 'notch' : 'allpass';
                f.frequency.value = this.tinnitusFrequency;   // initial value set directly (no start-up sweep)
                f.Q.value = initialQ;
                this._register(f, `NotchFilter[${i}]`);
                this.notchFilters.push(f);
            }
            for (let i = 0; i < this.notchFilters.length - 1; i++) {
                this._link(this.notchFilters[i], this.notchFilters[i + 1]);
            }
            this._link(this.notchFilters[this.notchFilters.length - 1], this.therapyGain);

            // Sound bus (mix point before the notch)
            this.soundBus = ctx.createGain();
            this.soundBus.gain.value = 1;
            this._register(this.soundBus, 'SoundBus');
            this._link(this.soundBus, this.notchFilters[0]);

            // Side tap: pre-notch analyser (for before/after comparison). Ends in a
            // silent sink so browsers reliably keep pulling audio through it.
            this.preAnalyser = this._createAnalyser();
            this._register(this.preAnalyser, 'PreNotchAnalyser');
            this._silentSink = ctx.createGain();
            this._silentSink.gain.value = 0;
            this._register(this._silentSink, 'SilentSink');
            this._link(this.soundBus, this.preAnalyser);
            this._link(this.preAnalyser, this._silentSink);
            this._link(this._silentSink, ctx.destination);

            console.log('Audio context initialized successfully');
        } catch (error) {
            console.error('Failed to initialize audio context:', error);
            if (typeof alert === 'function') {
                alert('오디오 시스템을 초기화할 수 없습니다. 브라우저가 Web Audio API를 지원하는지 확인해주세요.');
            }
        }
    }

    _createAnalyser() {
        const a = this.audioContext.createAnalyser();
        a.fftSize = 8192;                    // ~5.9 Hz / bin at 48 kHz
        a.smoothingTimeConstant = 0.85;
        a.minDecibels = -120;
        a.maxDecibels = -10;
        return a;
    }

    /* ─────────────────────── connection registry ────────────────────── */

    _register(node, name) {
        this._nodeNames.set(node, name);
    }

    _name(node) {
        return this._nodeNames.get(node) || '(unregistered)';
    }

    /** connect() + record the edge. Duplicate edges are ignored. */
    _link(from, to) {
        const key = `${this._name(from)}→${this._name(to)}`;
        if (this._edges.has(key)) return;
        from.connect(to);
        this._edges.add(key);
    }

    /** disconnect every output of `node` and forget its edges + name. */
    _release(node) {
        const name = this._name(node);
        try { node.disconnect(); } catch (e) { /* already disconnected */ }
        for (const key of Array.from(this._edges)) {
            const [a, b] = key.split('→');
            if (a === name || b === name) this._edges.delete(key);
        }
        this._nodeNames.delete(node);
    }

    /**
     * Verify the live graph using the app-level registry.
     * Checks required persistent edges, per-voice paths, duplicates, and that
     * exactly one notch cascade sits between every source and the output.
     */
    verifySignalChain() {
        this._sweepRetired();
        const errors = [];
        const has = (a, b) => this._edges.has(`${a}→${b}`);
        const n = this.notchFilters.length;

        if (!has('SoundBus', 'NotchFilter[0]')) errors.push('SoundBus → NotchFilter[0] missing');
        for (let i = 0; i < n - 1; i++) {
            if (!has(`NotchFilter[${i}]`, `NotchFilter[${i + 1}]`)) errors.push(`NotchFilter[${i}] → NotchFilter[${i + 1}] missing`);
        }
        if (!has(`NotchFilter[${n - 1}]`, 'TherapyGain')) errors.push('NotchFilter → TherapyGain missing');
        if (!has('TherapyGain', 'Analyser')) errors.push('TherapyGain → Analyser missing');
        if (!has('Analyser', 'MasterGain')) errors.push('Analyser → MasterGain missing');
        if (!has('MasterGain', 'Output')) errors.push('MasterGain → Output missing');

        // Persistent nodes must have exactly the expected number of outputs (no duplicates / bypass paths)
        const outDegree = {};
        this._edges.forEach(key => {
            const a = key.split('→')[0];
            outDegree[a] = (outDegree[a] || 0) + 1;
        });
        const expectOut = { 'TherapyGain': 1, 'Analyser': 1, 'MasterGain': 1, 'SoundBus': 2 };
        for (let i = 0; i < n; i++) expectOut[`NotchFilter[${i}]`] = 1;
        Object.keys(expectOut).forEach(k => {
            if ((outDegree[k] || 0) !== expectOut[k]) errors.push(`${k} has ${outDegree[k] || 0} outputs (expected ${expectOut[k]})`);
        });

        // Every live voice must reach the SoundBus through shaping and gain
        const liveVoices = this._voices.filter(v => !v.retiring);
        liveVoices.forEach(v => {
            if (!has(v.names.source, v.names.shaping)) errors.push(`${v.names.source} → shaping missing`);
            if (!has(v.names.shaping, v.names.character)) errors.push(`${v.names.shaping} → character gain missing`);
            if (!has(v.names.character, v.names.voice)) errors.push(`${v.names.character} → voice gain missing`);
            if (!has(v.names.voice, 'SoundBus')) errors.push(`${v.names.voice} → SoundBus missing`);
        });
        if (this.isTherapyPlaying && liveVoices.length !== 1) errors.push(`expected 1 live voice, found ${liveVoices.length}`);

        // Nothing may connect straight to the output except MasterGain / SilentSink
        this._edges.forEach(key => {
            const [a, b] = key.split('→');
            if (b === 'Output' && !['MasterGain', 'SilentSink'].includes(a)) errors.push(`unexpected direct connection ${key}`);
        });

        return {
            ok: errors.length === 0,
            errors,
            liveVoices: liveVoices.length,
            aliveVoices: this._voices.length,
            edgeCount: this._edges.size,
            notchStages: n,
            path: ['Source', 'Shaping', 'Notch' + (n > 1 ? ` ×${n}` : ''), 'Gain', 'Analyser', 'Master', 'Output']
        };
    }

    /** Sorted list of registered edges (for debugging). */
    getSignalChainEdges() {
        return Array.from(this._edges).sort();
    }

    /* ───────────────────────── notch parameters ─────────────────────── */

    _clampFrequency(f) {
        const nyq = this.audioContext ? this.audioContext.sampleRate / 2 : 24000;
        f = Number(f);
        if (!Number.isFinite(f)) f = this.tinnitusFrequency;
        return Math.min(Math.max(f, this.minFrequency), nyq * 0.9);
    }

    /** −3 dB bandwidth (octaves) → equivalent single-biquad notch Q (RBJ). */
    _bandwidthToQ(bwOct, f) {
        const w0 = 2 * Math.PI * f / this.audioContext.sampleRate;
        const s = Math.sin(w0);
        const warp = s > 1e-6 ? w0 / s : 1;
        return 1 / (2 * Math.sinh(Math.LN2 / 2 * bwOct * warp));
    }

    _qToBandwidth(q, f) {
        const w0 = 2 * Math.PI * f / this.audioContext.sampleRate;
        const s = Math.sin(w0);
        const warp = s > 1e-6 ? w0 / s : 1;
        return (2 / Math.LN2) * Math.asinh(1 / (2 * q)) / warp;
    }

    /**
     * N identical cascaded notches are wider at −3 dB than one. To keep the
     * requested overall −3 dB bandwidth, each stage is made proportionally
     * narrower: k = 1/√(2^(1/N) − 1)  (k = 1 for a single stage).
     */
    _stageQ(f) {
        const n = this.notchStages;
        const k = 1 / Math.sqrt(Math.pow(2, 1 / n) - 1);
        return this._bandwidthToQ(this.notchBandwidthOctaves, f) * k;
    }

    /** Equivalent single-notch Q ("notchQ") for the current bandwidth. */
    get notchQ() {
        return this._bandwidthToQ(this.notchBandwidthOctaves, this.tinnitusFrequency);
    }

    /** Push frequency + Q to the persistent notch nodes without clicks. */
    _applyNotchParams() {
        if (!this.notchFilters.length) return;
        const now = this.audioContext.currentTime;
        const f = this.tinnitusFrequency;
        const q = this._stageQ(f);
        const tc = this.frequencyTimeConstant;
        this.notchFilters.forEach(filter => {
            filter.frequency.cancelScheduledValues(now);
            filter.frequency.setTargetAtTime(f, now, tc);
            filter.Q.cancelScheduledValues(now);
            filter.Q.setTargetAtTime(q, now, tc);
        });
    }

    /**
     * Set tinnitus frequency (= notch centre). Safe to call at slider speed.
     */
    setFrequency(frequency) {
        const f = this._clampFrequency(frequency);
        this.tinnitusFrequency = f;

        // Smooth test-tone update
        if (this.isTestTonePlaying && this.testOscillator) {
            const now = this.audioContext.currentTime;
            this.testOscillator.frequency.cancelScheduledValues(now);
            this.testOscillator.frequency.setTargetAtTime(f, now, 0.01);
        }

        // The notch filter nodes stay in place; only their AudioParams move.
        this._applyNotchParams();
    }

    /** Set target −3 dB bandwidth in octaves (0.05 – 2). */
    setNotchBandwidth(octaves) {
        const bw = Math.min(Math.max(Number(octaves) || this.notchBandwidthOctaves, 0.05), 2);
        this.notchBandwidthOctaves = bw;
        this._applyNotchParams();
    }

    /** Set the equivalent single-notch Q directly (converted to a bandwidth). */
    setNotchQ(q) {
        q = Math.max(Number(q) || 1, 0.3);
        this.setNotchBandwidth(this._qToBandwidth(q, this.tinnitusFrequency));
    }

    /**
     * Combined magnitude response of the notch cascade at the given frequencies
     * (uses the real BiquadFilterNodes → reflects what the signal actually sees).
     */
    getNotchResponse(freqs) {
        const mag = new Float32Array(freqs.length).fill(1);
        const m = new Float32Array(freqs.length);
        const p = new Float32Array(freqs.length);
        this.notchFilters.forEach(filter => {
            filter.getFrequencyResponse(freqs, m, p);
            for (let i = 0; i < mag.length; i++) mag[i] *= m[i];
        });
        return mag;
    }

    /**
     * Snapshot of the real notch state read back from the AudioParams and from
     * the filters' frequency response (not from the requested values).
     */
    getNotchState() {
        const f0 = this.notchFilters[0];
        const actualCentreParam = f0 ? f0.frequency.value : NaN;
        const actualQ = f0 ? f0.Q.value : NaN;

        // Scan the real response on a fine log grid around the target
        const target = this.tinnitusFrequency;
        const nyq = this.audioContext.sampleRate / 2;
        const lo = Math.max(20, target / 4), hi = Math.min(nyq * 0.98, target * 4);
        const N = 1200;
        const grid = new Float32Array(N);
        for (let i = 0; i < N; i++) grid[i] = lo * Math.pow(hi / lo, i / (N - 1));
        const mag = this.getNotchResponse(grid);
        let minI = 0;
        for (let i = 1; i < N; i++) if (mag[i] < mag[minI]) minI = i;

        // −3 dB edges around the minimum
        let a = minI, b = minI;
        while (a > 0 && mag[a] < Math.SQRT1_2) a--;
        while (b < N - 1 && mag[b] < Math.SQRT1_2) b++;
        const bwOct = Math.log2(grid[b] / grid[a]);

        const magAtTarget = this.getNotchResponse(new Float32Array([target]))[0];

        return {
            tinnitusFrequency: target,
            notchEnabled: this.notchEnabled,
            filterType: f0 ? f0.type : null,
            stages: this.notchFilters.length,
            centreParamHz: actualCentreParam,
            measuredCentreHz: grid[minI],
            qPerStage: actualQ,
            notchQEquivalent: this.notchQ,
            requestedBandwidthOct: this.notchBandwidthOctaves,
            measuredBandwidthOct: bwOct,
            measuredEdgesHz: [grid[a], grid[b]],
            responseAtTargetDb: 20 * Math.log10(Math.max(magAtTarget, 1e-9))
        };
    }

    /* ───────────────────────────── volume ───────────────────────────── */

    setVolume(volume) {
        this.currentVolume = volume;
        if (this.masterGain) {
            const now = this.audioContext.currentTime;
            this.masterGain.gain.cancelScheduledValues(now);
            this.masterGain.gain.setTargetAtTime(volume, now, 0.015);
        }
    }

    /**
     * Resume audio context (required for user interaction)
     */
    async resumeContext() {
        if (this.isOffline) return;
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    /* ───────────────────────────── test tone ────────────────────────── */

    async playTestTone() {
        await this.resumeContext();

        if (this.isTestTonePlaying) {
            this.stopTestTone();
            return;
        }

        this.testOscillator = this.audioContext.createOscillator();
        this.testOscillator.type = 'sine';
        this.testOscillator.frequency.setValueAtTime(this.tinnitusFrequency, this.audioContext.currentTime);

        this.testGain = this.audioContext.createGain();
        this.testGain.gain.setValueAtTime(0.3, this.audioContext.currentTime);

        this._register(this.testOscillator, 'TestOscillator');
        this._register(this.testGain, 'TestGain');
        this._link(this.testOscillator, this.testGain);
        this._link(this.testGain, this.masterGain);

        this.testOscillator.start();
        this.isTestTonePlaying = true;

        console.log(`Test tone playing at ${this.tinnitusFrequency}Hz`);
    }

    stopTestTone() {
        if (this.testOscillator) {
            try { this.testOscillator.stop(); } catch (e) { }
            this._release(this.testOscillator);
            this.testOscillator = null;
        }
        if (this.testGain) {
            this._release(this.testGain);
            this.testGain = null;
        }
        this.isTestTonePlaying = false;
        console.log('Test tone stopped');
    }

    /* ─────────────────────────── noise generation ───────────────────── */

    /** Random source: deterministic when a seed is set, Math.random otherwise. */
    _rng(tag) {
        if (this._seed === null) return Math.random;
        return tinnitusMulberry32((tinnitusHashString(tag) ^ (this._seed >>> 0)) >>> 0);
    }

    /** Paul Kellet pink-noise generator (same coefficients as before). */
    _pinkGenerator(rng) {
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        return function () {
            const white = rng() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            const out = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
            b6 = white * 0.115926;
            return out;
        };
    }

    /**
     * Generate white noise buffer
     */
    createWhiteNoiseBuffer(duration = 2) {
        const sampleRate = this.audioContext.sampleRate;
        const bufferSize = Math.floor(sampleRate * duration);
        const buffer = this.audioContext.createBuffer(2, bufferSize, sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const rng = this._rng(`white:${channel}`);
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = rng() * 2 - 1;
            }
        }
        return buffer;
    }

    /**
     * Pink noise buffer (used as the broadband "bed")
     */
    createPinkNoiseBuffer(duration = 6) {
        const sampleRate = this.audioContext.sampleRate;
        const bufferSize = Math.floor(sampleRate * duration);
        const buffer = this.audioContext.createBuffer(2, bufferSize, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const pink = this._pinkGenerator(this._rng(`pink:${channel}`));
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.max(-1, Math.min(1, pink()));
            }
        }
        return buffer;
    }

    /**
     * Rain: bright high-passed hiss + frequent sharp droplet pops
     */
    createRainBuffer(duration = 4) {
        const sampleRate = this.audioContext.sampleRate;
        const bufferSize = Math.floor(sampleRate * duration);
        const buffer = this.audioContext.createBuffer(2, bufferSize, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const rng = this._rng(`rain:${channel}`);
            const data = buffer.getChannelData(channel);
            let hp = 0, lastWhite = 0;
            for (let i = 0; i < bufferSize; i++) {
                const white = rng() * 2 - 1;
                hp = white - lastWhite + 0.97 * hp;
                lastWhite = white;
                let out = hp * 0.35;
                if (rng() > 0.997) {
                    out += (rng() * 2 - 1) * 0.9;
                }
                data[i] = Math.max(-1, Math.min(1, out));
            }
        }
        return buffer;
    }

    /**
     * Wave: deep brown-noise rumble with a strong slow rolling swell, plus a
     * swell-locked "surf hiss" (pink noise). Real surf is broadband; the hiss
     * follows the swell so the sound stays natural while carrying energy up
     * to the top of the tinnitus-frequency range.
     */
    createWaveBuffer(duration = 8) {
        const sampleRate = this.audioContext.sampleRate;
        const bufferSize = Math.floor(sampleRate * duration);
        const buffer = this.audioContext.createBuffer(2, bufferSize, sampleRate);
        const HISS_LEVEL = 0.9;
        for (let channel = 0; channel < 2; channel++) {
            const rng = this._rng(`wave:${channel}`);
            const pink = this._pinkGenerator(this._rng(`wavehiss:${channel}`));
            const data = buffer.getChannelData(channel);
            let lastOut = 0;
            for (let i = 0; i < bufferSize; i++) {
                const white = rng() * 2 - 1;
                lastOut = (lastOut + (0.02 * white)) / 1.02;
                const swell = 0.15 + 0.85 * Math.pow(0.5 + 0.5 * Math.sin((i / bufferSize) * Math.PI * 2), 1.5);
                const rumble = lastOut * 6 * swell;
                const hiss = pink() * HISS_LEVEL * swell * swell;
                data[i] = Math.max(-1, Math.min(1, rumble + hiss));
            }
        }
        return buffer;
    }

    /**
     * Forest: Pink noise + subtle frequency modulation
     */
    createForestBuffer(duration = 5) {
        const sampleRate = this.audioContext.sampleRate;
        const bufferSize = Math.floor(sampleRate * duration);
        const buffer = this.audioContext.createBuffer(2, bufferSize, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const rng = this._rng(`forest:${channel}`);
            const pink = this._pinkGenerator(this._rng(`forestpink:${channel}`));
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < bufferSize; i++) {
                const out = pink();
                const wind = 0.55 + 0.45 * Math.sin((i / bufferSize) * Math.PI * 3);
                let val = out * wind * 0.9;
                if (rng() > 0.9992) {
                    val += (rng() * 2 - 1) * 0.25;
                }
                data[i] = Math.max(-1, Math.min(1, val));
            }
        }
        return buffer;
    }

    /**
     * Night Insects: Pink noise + high freq rhythmic chirps
     */
    createNightBuffer(duration = 3) {
        const sampleRate = this.audioContext.sampleRate;
        const bufferSize = Math.floor(sampleRate * duration);
        const buffer = this.audioContext.createBuffer(2, bufferSize, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const pink = this._pinkGenerator(this._rng(`night:${channel}`));
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < bufferSize; i++) {
                const out = pink();
                const t = i / sampleRate;
                const chirpEnv = Math.pow(Math.max(0, Math.sin(t * Math.PI * 6)), 30);
                const tone = Math.sin(2 * Math.PI * 4200 * t);
                const chirp = tone * chirpEnv * 0.5;
                data[i] = Math.max(-1, Math.min(1, out * 0.25 + chirp));
            }
        }
        return buffer;
    }

    /**
     * Temple: Pink noise + resonant peak for "metallic" hum
     */
    createTempleBuffer(duration = 6) {
        const sampleRate = this.audioContext.sampleRate;
        const bufferSize = Math.floor(sampleRate * duration);
        const buffer = this.audioContext.createBuffer(2, bufferSize, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const pink = this._pinkGenerator(this._rng(`temple:${channel}`));
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < bufferSize; i++) {
                const out = pink();
                const t = i / sampleRate;
                const beat = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.15 * t);
                const resonance = (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 440 * t)) * 0.18 * beat;
                data[i] = Math.max(-1, Math.min(1, out * 0.3 + resonance));
            }
        }
        return buffer;
    }

    /** Buffers are generated once per sound and reused (no regeneration on switch). */
    _getSoundBuffer(soundType) {
        if (this._soundBuffers.has(soundType)) return this._soundBuffers.get(soundType);
        const seconds = this.getProfile(soundType).bufferSeconds;
        let buffer;
        switch (soundType) {
            case 'rain': buffer = this.createRainBuffer(seconds); break;
            case 'wave': buffer = this.createWaveBuffer(seconds); break;
            case 'forest': buffer = this.createForestBuffer(seconds); break;
            case 'night': buffer = this.createNightBuffer(seconds); break;
            case 'temple': buffer = this.createTempleBuffer(seconds); break;
            case 'whitenoise':
            default: buffer = this.createWhiteNoiseBuffer(seconds);
        }
        this._soundBuffers.set(soundType, buffer);
        return buffer;
    }

    _getBedBuffer(kind) {
        if (this._noiseBuffers.has(kind)) return this._noiseBuffers.get(kind);
        const buffer = kind === 'white' ? this.createWhiteNoiseBuffer(4) : this.createPinkNoiseBuffer(6);
        this._noiseBuffers.set(kind, buffer);
        return buffer;
    }

    getProfile(soundType) {
        return TINNITUS_SOUND_PROFILES[soundType] || TINNITUS_SOUND_PROFILES.whitenoise;
    }

    /**
     * Create a per-sound shaping filter. Shelving / peaking types colour the
     * sound without deleting whole regions of the spectrum (see profiles).
     */
    createShapingFilter(soundType) {
        const filter = this.audioContext.createBiquadFilter();
        const now = this.audioContext.currentTime;
        const s = this.getProfile(soundType).shaping;
        if (!s) {
            filter.type = 'allpass';
            filter.frequency.setValueAtTime(1000, now);
            filter.Q.setValueAtTime(0.7071, now);
            return filter;
        }
        filter.type = s.type;
        filter.frequency.setValueAtTime(s.frequency, now);
        if (s.Q !== undefined) filter.Q.setValueAtTime(s.Q, now);
        if (s.gain !== undefined) filter.gain.setValueAtTime(s.gain, now);
        return filter;
    }

    /**
     * Makeup gain per sound so filtering doesn't make some sounds feel
     * quieter than others.
     */
    getSoundGain(soundType) {
        return this.getProfile(soundType).makeup;
    }

    /**
     * Create a standalone notch filter (kept for API compatibility). The engine
     * itself uses the persistent cascade built in initAudioContext().
     */
    createNotchFilter(frequency, Q = 30) {
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'notch';
        filter.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        filter.Q.setValueAtTime(Q, this.audioContext.currentTime);
        return filter;
    }

    /* ───────────────────────────── voices ───────────────────────────── */

    /**
     * Build one voice:
     *   source → shaping → characterGain ─┐
     *   bedSource → bedGain ──────────────┴→ voiceGain → SoundBus
     * The voice owns every node it creates and releases them all on dispose.
     */
    _createVoice(soundType) {
        const ctx = this.audioContext;
        const now = ctx.currentTime;
        const profile = this.getProfile(soundType);
        const id = ++this._voiceSeq;
        const tag = `${soundType}#${id}`;

        const source = ctx.createBufferSource();
        source.buffer = this._getSoundBuffer(soundType);
        source.loop = true;

        const shaping = this.createShapingFilter(soundType);
        const character = ctx.createGain();
        character.gain.setValueAtTime(this.getSoundGain(soundType), now);
        const voiceGain = ctx.createGain();
        voiceGain.gain.setValueAtTime(0, now);

        const voice = {
            id, soundType, retiring: false, disposed: false,
            sources: [source], nodes: [source, shaping, character, voiceGain],
            voiceGain,
            names: {
                source: `Source:${tag}`, shaping: `Shaping:${tag}`,
                character: `CharGain:${tag}`, voice: `VoiceGain:${tag}`
            }
        };

        this._register(source, voice.names.source);
        this._register(shaping, voice.names.shaping);
        this._register(character, voice.names.character);
        this._register(voiceGain, voice.names.voice);

        this._link(source, shaping);
        this._link(shaping, character);
        this._link(character, voiceGain);
        this._link(voiceGain, this.soundBus);

        // Broadband bed (mixed before the notch, so the notch cuts it too)
        if (profile.bed && profile.bed.level > 0) {
            const bedSrc = ctx.createBufferSource();
            bedSrc.buffer = this._getBedBuffer(profile.bed.source);
            bedSrc.loop = true;
            const bedGain = ctx.createGain();
            bedGain.gain.setValueAtTime(profile.bed.level, now);
            this._register(bedSrc, `BedSource:${tag}`);
            this._register(bedGain, `BedGain:${tag}`);
            voice.sources.push(bedSrc);
            voice.nodes.push(bedSrc, bedGain);
            this._link(bedSrc, bedGain);
            this._link(bedGain, voiceGain);
        }

        voice.sources.forEach(s => s.start());
        return voice;
    }

    _fadeVoiceIn(voice, seconds) {
        const now = this.audioContext.currentTime;
        const g = voice.voiceGain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(0, now);
        g.linearRampToValueAtTime(1, now + seconds);
    }

    /** Fade a voice out, stop its sources, and release every node it owns. */
    _retireVoice(voice, seconds) {
        if (voice.retiring || voice.disposed) return;
        voice.retiring = true;
        const now = this.audioContext.currentTime;
        const g = voice.voiceGain.gain;
        const current = g.value;
        g.cancelScheduledValues(now);
        g.setValueAtTime(current, now);
        g.linearRampToValueAtTime(0, now + seconds);

        const stopAt = now + seconds + 0.02;
        voice.stopAt = stopAt;
        voice.sources.forEach(s => {
            try { s.stop(stopAt); } catch (e) { }
        });
        // Real-time contexts: release on the first source's `ended`, with a timer
        // as a backup for suspended/closed contexts. Offline contexts are released
        // deterministically by _sweepRetired() using the audio clock instead of
        // asynchronous callbacks.
        if (!this.isOffline) {
            voice.sources[0].onended = () => this._disposeVoice(voice);
            setTimeout(() => this._disposeVoice(voice), (seconds + 0.25) * 1000);
        }
    }

    /** Dispose retired voices whose fade-out has finished (audio-clock based). */
    _sweepRetired() {
        const now = this.audioContext.currentTime;
        this._voices.filter(v => v.retiring && v.stopAt !== undefined && now >= v.stopAt + 0.01)
            .forEach(v => this._disposeVoice(v));
    }

    _disposeVoice(voice) {
        if (voice.disposed) return;
        voice.disposed = true;
        voice.sources.forEach(s => { s.onended = null; try { s.stop(); } catch (e) { } });
        voice.nodes.forEach(n => this._release(n));
        this._voices = this._voices.filter(v => v !== voice);
    }

    /**
     * Make `soundType` the audible voice. When a sound is already playing the
     * old voice is cross-faded out; only the voice nodes are created/destroyed.
     */
    _engageSound(soundType, crossfade) {
        const fade = this.soundFadeSeconds;
        this._sweepRetired();

        // Retire every currently live voice
        this._voices.filter(v => !v.retiring).forEach(v => this._retireVoice(v, fade));

        // Hard cap on alive (fading) voices – drop the oldest immediately
        while (this._voices.length >= this.maxVoices) {
            this._disposeVoice(this._voices[0]);
        }

        const voice = this._createVoice(soundType);
        this._voices.push(voice);
        this._fadeVoiceIn(voice, crossfade ? fade : Math.max(fade, 0.15));
        this.currentSound = soundType;
        return voice;
    }

    /**
     * Start therapy with selected sound
     * @param {string} soundType Type of sound to play
     * @param {boolean} isSwitching Internal flag for real-time sound switching
     */
    async startTherapy(soundType = 'whitenoise', isSwitching = false) {
        await this.resumeContext();
        return this._startTherapySync(soundType, isSwitching);
    }

    _startTherapySync(soundType = 'whitenoise', isSwitching = false) {
        // If already playing and NOT switching, stop therapy
        if (this.isTherapyPlaying && !isSwitching) {
            this.stopTherapy();
            return;
        }

        const wasPlaying = this.isTherapyPlaying;

        // Re-selecting the sound that is already playing: nothing to do
        if (wasPlaying) {
            const live = this._voices.find(v => !v.retiring);
            if (live && live.soundType === soundType) return;
        }

        // Make sure the notch is on the current frequency before audio flows
        this._applyNotchParams();
        this._engageSound(soundType, wasPlaying);
        this.isTherapyPlaying = true;

        if (!wasPlaying && this.enableTimer) {
            this.startTimer();
        }

        console.log(`Therapy ${wasPlaying ? 'switched to' : 'started with'} ${soundType} at ${this.tinnitusFrequency}Hz (notched)`);
    }

    /** Explicit sound switch (same as startTherapy(sound, true)). */
    switchSound(soundType) {
        this.currentSound = soundType;
        if (this.isTherapyPlaying) this._startTherapySync(soundType, true);
    }

    /**
     * Stop therapy: fade voices out and release them. The persistent
     * notch / gain / analyser nodes stay in the graph (no rebuild on restart).
     */
    stopTherapy() {
        this._voices.filter(v => !v.retiring).forEach(v => this._retireVoice(v, 0.1));
        this.isTherapyPlaying = false;
        this.stopTimer();
        console.log('Therapy stopped');
    }

    /* ───────────────────────────── timer ────────────────────────────── */

    startTimer() {
        this.stopTimer();
        this.therapyStartTime = Date.now();
        this.timerInterval = setInterval(() => {
            this.therapyDuration = Math.floor((Date.now() - this.therapyStartTime) / 1000);
            this.updateTimerDisplay();

            // Auto-stop check
            if (this.therapyDuration >= this.maxDuration) {
                this.stopTherapy();
                if (typeof this.onAutoStop === 'function') {
                    this.onAutoStop();
                }
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    updateTimerDisplay() {
        const minutes = Math.floor(this.therapyDuration / 60);
        const seconds = this.therapyDuration % 60;
        const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        const timerElement = document.querySelector('.timer-time');
        if (timerElement) {
            timerElement.textContent = display;
        }
    }

    /* ───────────────────── analyser access / live measurement ───────── */

    /**
     * Get analyser data for visualization (time domain – kept for compatibility)
     */
    getAnalyserData() {
        if (!this.analyser) return null;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteTimeDomainData(dataArray);

        return {
            bufferLength,
            dataArray
        };
    }

    /**
     * Frequency-domain data (dB per bin) of the ACTUAL output signal
     * (after the notch and therapy gain) and of the pre-notch tap.
     */
    getSpectrumData() {
        if (!this.analyser || !this.analyser.getFloatFrequencyData) return null;
        const bins = this.analyser.frequencyBinCount;
        if (!this._postDb || this._postDb.length !== bins) {
            this._postDb = new Float32Array(bins);
            this._preDb = new Float32Array(bins);
        }
        this.analyser.getFloatFrequencyData(this._postDb);
        this.preAnalyser.getFloatFrequencyData(this._preDb);
        return {
            postDb: this._postDb,
            preDb: this._preDb,
            sampleRate: this.audioContext.sampleRate,
            fftSize: this.analyser.fftSize
        };
    }

    /**
     * Live before/after measurement from the two analysers.
     * pre  = signal entering the notch (SoundBus tap)
     * post = signal after notch + therapy gain (level-compensated for TherapyGain)
     */
    measureLive(bandOctaves = 1 / 12) {
        const spec = this.getSpectrumData();
        if (!spec) return null;
        const T = TinnitusSpectrumTools;
        const f = this.tinnitusFrequency;
        const { postDb, preDb, sampleRate, fftSize } = spec;
        const prePow = T.dbToPower(preDb);
        const postPow = T.dbToPower(postDb);

        const gain = this.therapyGain.gain.value;
        const comp = gain > 1e-4 ? 20 * Math.log10(gain) : 0;

        const pre = T.bandLevelDb(prePow, sampleRate, fftSize, f, bandOctaves);
        const post = T.bandLevelDb(postPow, sampleRate, fftSize, f, bandOctaves) - comp;
        const silent = pre < -115;   // nothing playing / analyser floor
        return {
            frequency: f,
            preDb: pre,
            postDb: post,
            attenuationDb: silent ? null : pre - post,
            dipVsShouldersDb: silent ? null : T.dipVsShouldersDb(postPow, sampleRate, fftSize, f, bandOctaves),
            silent
        };
    }

    /* ─────────────────────── offline self-test (verification) ───────── */

    /**
     * Render the REAL engine graph in an OfflineAudioContext and measure the
     * notch from FFT data. Two renders use identical (seeded) noise:
     *   before – notch stages bypassed (allpass)
     *   after  – normal notch chain
     * so the level difference at the tinnitus frequency is the notch itself.
     *
     * @returns {Promise<Object>} measurement report
     */
    static async runSelfTest(options = {}) {
        const {
            sound = 'whitenoise',
            frequency = 6000,
            bandwidthOctaves = 0.5,
            stages = 2,
            seconds = 3,
            sampleRate = 48000,
            seed = 20240607,
            fftSize = 16384,
            bandOctaves = 1 / 12
        } = options;
        const T = TinnitusSpectrumTools;
        const Offline = (typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext)) || null;
        if (!Offline) throw new Error('OfflineAudioContext is not available');

        const render = async (notchEnabled) => {
            const ctx = new Offline(2, Math.floor(sampleRate * seconds), sampleRate);
            const eng = new TinnitusAudioEngine({
                audioContext: ctx, enableTimer: false, seed, notchEnabled,
                tinnitusFrequency: frequency, notchBandwidthOctaves: bandwidthOctaves, notchStages: stages
            });
            eng.masterGain.gain.value = 1;                 // measure the signal, not the user volume
            eng._startTherapySync(sound, false);
            const chain = eng.verifySignalChain();
            const notchState = eng.getNotchState();
            const buf = await ctx.startRendering();
            const ch = buf.getChannelData(0);
            const skip = Math.floor(sampleRate * 1.0);     // skip fade-in
            const x = ch.slice(skip);
            let sum = 0, peak = 0;
            for (let i = 0; i < x.length; i++) { sum += x[i] * x[i]; peak = Math.max(peak, Math.abs(x[i])); }
            return { x, rms: Math.sqrt(sum / x.length), peak, chain, notchState };
        };

        const before = await render(false);
        const after = await render(true);
        const psdBefore = T.welchPsd(before.x, fftSize);
        const psdAfter = T.welchPsd(after.x, fftSize);

        const preDb = T.bandLevelDb(psdBefore, sampleRate, fftSize, frequency, bandOctaves);
        const postDb = T.bandLevelDb(psdAfter, sampleRate, fftSize, frequency, bandOctaves);
        const attenuationDb = preDb - postDb;
        const dipVsShouldersDb = T.dipVsShouldersDb(psdAfter, sampleRate, fftSize, frequency, bandOctaves);

        // Spectral coverage of the pre-notch sound over 250–12000 Hz (1/3-octave bands)
        const centres = T.thirdOctaveCentres(250, 12000);
        const levels = centres.map(fc => T.bandLevelDb(psdBefore, sampleRate, fftSize, fc, 1 / 3));
        const sorted = levels.slice().sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const levelAtFreqRelMedian = T.bandLevelDb(psdBefore, sampleRate, fftSize, frequency, 1 / 3) - median;

        const passAttenuation = attenuationDb >= 20;
        const passEnergy = levelAtFreqRelMedian >= -25;

        return {
            sound, frequency, sampleRate, seconds, bandwidthOctaves, stages,
            preDb, postDb, attenuationDb, dipVsShouldersDb,
            worstBandVsMedianDb: sorted[0] - median,
            levelAtFrequencyVsMedianDb: levelAtFreqRelMedian,
            bandCentresHz: centres,
            bandLevelsDb: levels,
            rmsBefore: before.rms, rmsAfter: after.rms,
            peakAfter: after.peak,
            chain: after.chain,
            notchState: after.notchState,
            passAttenuation, passEnergy,
            pass: passAttenuation && passEnergy && after.chain.ok
        };
    }

    /* ─────────────────────────── cleanup ────────────────────────────── */

    destroy() {
        this.stopTestTone();
        this.stopTherapy();
        this._voices.slice().forEach(v => this._disposeVoice(v));

        if (this.audioContext && this.audioContext.close) {
            this.audioContext.close();
        }
    }
}

// Export for use in app.js
window.TinnitusAudioEngine = TinnitusAudioEngine;
window.TinnitusSpectrumTools = TinnitusSpectrumTools;
window.TINNITUS_SOUND_PROFILES = TINNITUS_SOUND_PROFILES;
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TinnitusAudioEngine, TinnitusSpectrumTools, TINNITUS_SOUND_PROFILES };
}
