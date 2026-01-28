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
     * Rain: Brown noise + high-freq crackles
     */
    createRainBuffer(duration = 4) {
        const sampleRate = this.audioContext.sampleRate;
        const bufferSize = sampleRate * duration;
        const buffer = this.audioContext.createBuffer(2, bufferSize, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            let lastOut = 0;
            for (let i = 0; i < bufferSize; i++) {
                const white = Math.random() * 2 - 1;
                let out = (lastOut + (0.02 * white)) / 1.002;
                data[i] = out * 2;
                lastOut = out;
                if (Math.random() > 0.9995) {
                    data[i] += (Math.random() * 2 - 1) * 0.5;
                }
            }
        }
        return buffer;
    }

    /**
     * Wave: Brown noise + slow volume modulation
     */
    createWaveBuffer(duration = 6) {
        const sampleRate = this.audioContext.sampleRate;
        const bufferSize = sampleRate * duration;
        const buffer = this.audioContext.createBuffer(2, bufferSize, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            let lastOut = 0;
            for (let i = 0; i < bufferSize; i++) {
                const white = Math.random() * 2 - 1;
                let out = (lastOut + (0.02 * white)) / 1.002;
                lastOut = out;
                const lfo = 0.5 + 0.5 * Math.sin((i / bufferSize) * Math.PI * 2);
                data[i] = out * 4 * lfo;
            }
        }
        return buffer;
    }

    /**
     * Forest: Pink noise + subtle frequency modulation
     */
    createForestBuffer(duration = 4) {
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
                const wind = 0.7 + 0.3 * Math.sin((i / bufferSize) * Math.PI * 4);
                data[i] = out * wind;
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
                const chirpEnv = Math.pow(0.5 + 0.5 * Math.sin((i / sampleRate) * Math.PI * 10), 20);
                const chirp = (Math.random() * 2 - 1) * chirpEnv * 0.15;
                data[i] = out * 0.4 + chirp;
            }
        }
        return buffer;
    }

    /**
     * Temple: Pink noise + resonant peak for "metallic" hum
     */
    createTempleBuffer(duration = 4) {
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
                const resonance = Math.sin((i / sampleRate) * Math.PI * 2 * 380) * 0.015;
                data[i] = out + resonance;
            }
        }
        return buffer;
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

        // Create notch filter if it doesn't exist
        if (!this.notchFilter) {
            this.notchFilter = this.createNotchFilter(this.currentFrequency);
        }

        // Create gain for therapy if it doesn't exist
        if (!this.therapyGain) {
            this.therapyGain = this.audioContext.createGain();
            this.therapyGain.gain.setValueAtTime(0.7, this.audioContext.currentTime);
        }

        // Connect audio graph
        this.therapySource.connect(this.notchFilter);
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
