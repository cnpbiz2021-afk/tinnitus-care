/**
 * Tinnitus Care - Audio Engine
 * Web Audio API based Notched Sound Therapy Implementation
 */

class TinnitusAudioEngine {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.analyser = null;

        // Oscillator for test tone
        this.testOscillator = null;
        this.testGain = null;

        // Therapy audio nodes
        this.therapySource = null;
        this.therapyGain = null;
        this.notchFilter = null;
        this.shapingFilter = null;

        // State
        this.isTestTonePlaying = false;
        this.isTherapyPlaying = false;
        this.currentFrequency = 4000;
        this.currentVolume = 0.5;
        this.currentSound = 'whitenoise';

        // Timer
        this.therapyStartTime = null;
        this.therapyDuration = 0;
        this.timerInterval = null;

        this.onAutoStop = null;
        this.maxDuration = 1800; // 30 minutes in seconds

        this.initAudioContext();
    }

    /**
     * Initialize Web Audio API context
     */
    initAudioContext() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Create master gain node
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = this.currentVolume;
            this.masterGain.connect(this.audioContext.destination);

            // Create analyser for visualization
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.connect(this.masterGain);

            console.log('Audio context initialized successfully');
        } catch (error) {
            console.error('Failed to initialize audio context:', error);
            alert('오디오 시스템을 초기화할 수 없습니다. 브라우저가 Web Audio API를 지원하는지 확인해주세요.');
        }
    }

    /**
     * Resume audio context (required for user interaction)
     */
    async resumeContext() {
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    /**
     * Set tinnitus frequency
     */
    setFrequency(frequency) {
        this.currentFrequency = frequency;

        // Update test oscillator if playing
        if (this.isTestTonePlaying && this.testOscillator) {
            this.testOscillator.frequency.setValueAtTime(
                frequency,
                this.audioContext.currentTime
            );
        }

        // Update notch filter if therapy is playing
        if (this.isTherapyPlaying && this.notchFilter) {
            this.notchFilter.frequency.setValueAtTime(
                frequency,
                this.audioContext.currentTime
            );
        }
    }

    /**
     * Set volume
     */
    setVolume(volume) {
        this.currentVolume = volume;
        if (this.masterGain) {
            this.masterGain.gain.setValueAtTime(
                volume,
                this.audioContext.currentTime
            );
        }
    }

    /**
     * Play test tone at current frequency
     */
    async playTestTone() {
        await this.resumeContext();

        if (this.isTestTonePlaying) {
            this.stopTestTone();
            return;
        }

        // Create oscillator
        this.testOscillator = this.audioContext.createOscillator();
        this.testOscillator.type = 'sine';
        this.testOscillator.frequency.setValueAtTime(
            this.currentFrequency,
            this.audioContext.currentTime
        );

        // Create gain for test tone
        this.testGain = this.audioContext.createGain();
        this.testGain.gain.setValueAtTime(0.3, this.audioContext.currentTime);

        // Connect nodes
        this.testOscillator.connect(this.testGain);
        this.testGain.connect(this.masterGain);

        // Start oscillator
        this.testOscillator.start();
        this.isTestTonePlaying = true;

        console.log(`Test tone playing at ${this.currentFrequency}Hz`);
    }

    /**
     * Stop test tone
     */
    stopTestTone() {
        if (this.testOscillator) {
            this.testOscillator.stop();
            this.testOscillator.disconnect();
            this.testOscillator = null;
        }

        if (this.testGain) {
            this.testGain.disconnect();
            this.testGain = null;
        }

        this.isTestTonePlaying = false;
        console.log('Test tone stopped');
    }

    /**
     * Generate white noise buffer
     */
    createWhiteNoiseBuffer(duration = 2) {
        const sampleRate = this.audioContext.sampleRate;
        const bufferSize = sampleRate * duration;
        const buffer = this.audioContext.createBuffer(2, bufferSize, sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
        }

        return buffer;
    }

    /**
     * Rain: bright high-passed hiss + frequent sharp droplet pops
     */
    createRainBuffer(duration = 4) {
        const sampleRate = this.audioContext.sampleRate;
        const bufferSize = sampleRate * duration;
        const buffer = this.audioContext.createBuffer(2, bufferSize, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            let hp = 0, lastWhite = 0;
            for (let i = 0; i < bufferSize; i++) {
                const white = Math.random() * 2 - 1;
                hp = white - lastWhite + 0.97 * hp;
                lastWhite = white;
                let out = hp * 0.35;
                if (Math.random() > 0.997) {
                    out += (Math.random() * 2 - 1) * 0.9;
                }
                data[i] = Math.max(-1, Math.min(1, out));
            }
        }
        return buffer;
    }

    /**
     * Wave: deep brown-noise rumble with a strong slow rolling swell
     */
    createWaveBuffer(duration = 8) {
        const sampleRate = this.audioContext.sampleRate;
        const bufferSize = sampleRate * duration;
        const buffer = this.audioContext.createBuffer(2, bufferSize, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            let lastOut = 0;
            for (let i = 0; i < bufferSize; i++) {
                const white = Math.random() * 2 - 1;
                lastOut = (lastOut + (0.02 * white)) / 1.02;
                const swell = 0.15 + 0.85 * Math.pow(0.5 + 0.5 * Math.sin((i / bufferSize) * Math.PI * 2), 1.5);
                data[i] = Math.max(-1, Math.min(1, lastOut * 6 * swell));
            }
        }
        return buffer;
    }

    /**
     * Forest: Pink noise + subtle frequency modulation
     */
    createForestBuffer(duration = 5) {
        const sampleRate = this.audioContext.sampleRate;
        const bufferSize = sampleRate * duration;
        const buffer = this.audioContext.createBuffer(2, bufferSize, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
            for (let i = 0; i < bufferSize; i++) {
                const white = Math.random() * 2 - 1;
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856;
                b4 = 0.55000 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.0168980;
                let out = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
                b6 = white * 0.115926;
                const wind = 0.55 + 0.45 * Math.sin((i / bufferSize) * Math.PI * 3);
                let val = out * wind * 0.9;
                if (Math.random() > 0.9992) {
                    val += (Math.random() * 2 - 1) * 0.25;
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
        const bufferSize = sampleRate * duration;
        const buffer = this.audioContext.createBuffer(2, bufferSize, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
            for (let i = 0; i < bufferSize; i++) {
                const white = Math.random() * 2 - 1;
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856;
                b4 = 0.55000 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.0168980;
                let out = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
                b6 = white * 0.115926;
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
        const bufferSize = sampleRate * duration;
        const buffer = this.audioContext.createBuffer(2, bufferSize, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
            for (let i = 0; i < bufferSize; i++) {
                const white = Math.random() * 2 - 1;
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856;
                b4 = 0.55000 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.0168980;
                let out = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
                b6 = white * 0.115926;
                const t = i / sampleRate;
                const beat = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.15 * t);
                const resonance = (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 440 * t)) * 0.18 * beat;
                data[i] = Math.max(-1, Math.min(1, out * 0.3 + resonance));
            }
        }
        return buffer;
    }

    /**
     * Create a per-sound shaping filter so each therapy sound occupies a
     * clearly different, easily distinguishable frequency range.
     */
    createShapingFilter(soundType) {
        const filter = this.audioContext.createBiquadFilter();
        const now = this.audioContext.currentTime;
        switch (soundType) {
            case 'rain':
                filter.type = 'highpass';
                filter.frequency.setValueAtTime(700, now);
                filter.Q.setValueAtTime(0.7, now);
                break;
            case 'wave':
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(350, now);
                filter.Q.setValueAtTime(0.7, now);
                break;
            case 'forest':
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(1200, now);
                filter.Q.setValueAtTime(0.6, now);
                break;
            case 'night':
                filter.type = 'highpass';
                filter.frequency.setValueAtTime(1500, now);
                filter.Q.setValueAtTime(0.7, now);
                break;
            case 'temple':
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(900, now);
                filter.Q.setValueAtTime(1.0, now);
                break;
            case 'whitenoise':
            default:
                filter.type = 'allpass';
                filter.frequency.setValueAtTime(1000, now);
                filter.Q.setValueAtTime(0.0001, now);
                break;
        }
        return filter;
    }

    /**
     * Makeup gain per sound so filtering doesn't make some sounds feel
     * quieter than others.
     */
    getSoundGain(soundType) {
        const gains = {
            whitenoise: 0.7,
            rain: 0.85,
            wave: 0.9,
            forest: 0.95,
            night: 0.75,
            temple: 0.8
        };
        return gains[soundType] !== undefined ? gains[soundType] : 0.7;
    }

    /**
     * Create notch filter
     * This is the core of the therapy - removes the tinnitus frequency band
     */
    createNotchFilter(frequency, Q = 30) {
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'notch';
        filter.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        filter.Q.setValueAtTime(Q, this.audioContext.currentTime);
        return filter;
    }

    /**
     * Start therapy with selected sound
     * @param {string} soundType Type of sound to play
     * @param {boolean} isSwitching Internal flag for real-time sound switching
     */
    async startTherapy(soundType = 'whitenoise', isSwitching = false) {
        await this.resumeContext();

        // If already playing and NOT switching, stop therapy
        if (this.isTherapyPlaying && !isSwitching) {
            this.stopTherapy();
            return;
        }

        // If switching, cleanup the current source before starting new one
        if (isSwitching && this.therapySource) {
            try {
                this.therapySource.stop();
                this.therapySource.disconnect();
            } catch (e) { }
        }

        this.currentSound = soundType;

        // Create audio buffer based on sound type
        let buffer;
        switch (soundType) {
            case 'whitenoise':
                buffer = this.createWhiteNoiseBuffer(2);
                break;
            case 'rain':
                buffer = this.createRainBuffer(4);
                break;
            case 'wave':
                buffer = this.createWaveBuffer(6);
                break;
            case 'forest':
                buffer = this.createForestBuffer(4);
                break;
            case 'night':
                buffer = this.createNightBuffer(3);
                break;
            case 'temple':
                buffer = this.createTempleBuffer(4);
                break;
            default:
                buffer = this.createWhiteNoiseBuffer(2);
        }

        // Create buffer source
        this.therapySource = this.audioContext.createBufferSource();
        this.therapySource.buffer = buffer;
        this.therapySource.loop = true;

        // Shaping filter gives each sound its own distinct frequency range;
        // recreated every time since it depends on the selected sound type
        if (this.shapingFilter) {
            try {
                this.shapingFilter.disconnect();
            } catch (e) { }
        }
        this.shapingFilter = this.createShapingFilter(soundType);

        // Create notch filter if it doesn't exist
        if (!this.notchFilter) {
            this.notchFilter = this.createNotchFilter(this.currentFrequency);
        }

        // Create gain for therapy if it doesn't exist
        if (!this.therapyGain) {
            this.therapyGain = this.audioContext.createGain();
        }
        // Re-balance loudness per sound so switching sounds feels consistent
        this.therapyGain.gain.setValueAtTime(this.getSoundGain(soundType), this.audioContext.currentTime);

        // Connect audio graph: source -> shaping filter -> notch filter -> gain -> analyser
        this.therapySource.connect(this.shapingFilter);
        this.shapingFilter.connect(this.notchFilter);
        if (this.notchFilter.numberOfOutputs === 0 || !this.notchFilter.connected) {
            this.notchFilter.connect(this.therapyGain);
        }
        if (this.therapyGain.numberOfOutputs === 0 || !this.therapyGain.connected) {
            this.therapyGain.connect(this.analyser);
        }

        // Start playback
        this.therapySource.start();
        this.isTherapyPlaying = true;

        // Start timer only if not switching
        if (!isSwitching) {
            this.startTimer();
        }

        console.log(`Therapy ${isSwitching ? 'switched to' : 'started with'} ${soundType} at ${this.currentFrequency}Hz (notched)`);
    }

    /**
     * Stop therapy
     */
    stopTherapy() {
        if (this.therapySource) {
            this.therapySource.stop();
            this.therapySource.disconnect();
            this.therapySource = null;
        }

        if (this.shapingFilter) {
            this.shapingFilter.disconnect();
            this.shapingFilter = null;
        }

        if (this.notchFilter) {
            this.notchFilter.disconnect();
            this.notchFilter = null;
        }

        if (this.therapyGain) {
            this.therapyGain.disconnect();
            this.therapyGain = null;
        }

        this.isTherapyPlaying = false;
        this.stopTimer();

        console.log('Therapy stopped');
    }

    /**
     * Start therapy timer
     */
    startTimer() {
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

    /**
     * Stop therapy timer
     */
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    /**
     * Update timer display
     */
    updateTimerDisplay() {
        const minutes = Math.floor(this.therapyDuration / 60);
        const seconds = this.therapyDuration % 60;
        const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        const timerElement = document.querySelector('.timer-time');
        if (timerElement) {
            timerElement.textContent = display;
        }
    }

    /**
     * Get analyser data for visualization
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
     * Cleanup
     */
    destroy() {
        this.stopTestTone();
        this.stopTherapy();

        if (this.audioContext) {
            this.audioContext.close();
        }
    }
}

// Export for use in app.js
window.TinnitusAudioEngine = TinnitusAudioEngine;
