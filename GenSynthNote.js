/**
 * GenSynthNote
 * -------------
 * A single polyphonic "note" voice implemented with the Web Audio API.
 * - Source: one OscillatorNode (sawtooth)
 * - Amplitude envelope: ADSR on a GainNode (this.adsr.gain)
 * - Timbre envelope: one low-pass BiquadFilterNode sweeping its cutoff
 *
 * Usage pattern (per note/voice):
 *   const voice = new GenSynthNote(ctx, masterGain, 69, 0.02, 0.15, 0.6, 0.25);
 *   voice.start();   // schedules attack/decay etc.
 *   // ...later...
 *   voice.stop();    // schedules release and stops the oscillator
 *
 * Important Web Audio behaviors to remember:
 * - OscillatorNode.start() may be called only once per oscillator.
 * - OscillatorNode.stop() is final for that oscillator.
 * - Automation (setValueAtTime/linearRampToValueAtTime) is sample-accurate and
 *   time-based in the AudioContext clock (seconds).
 *
 * @export
 */
export default class GenSynthNote {

    /**
     * @param {BaseAudioContext} context  An AudioContext or OfflineAudioContext
     * @param {AudioNode} dest            Where this note should end up (e.g., a master GainNode)
     * @param {number} midiNote           MIDI note number (e.g., 69 -> A4 = 440 Hz)
     * @param {number} attack             Seconds to ramp from current gain to maxGain
     * @param {number} decay              Seconds to ramp from maxGain down to sustain level
     * @param {number} sustain            Sustain level as a fraction of maxGain (0..1)
     * @param {number} release            Seconds to ramp from current gain to 0 on stop()
     */
    constructor(context, dest, midiNote, attack, decay, sustain, release) {

        // Keep a reference to the audio context for timing and node creation
        this.ctx = context;

        // Convert MIDI note to frequency in Hz (A4=440, MIDI 69)
        this.freq = this.mtof(midiNote);

        // ADSR envelope parameters in seconds (A, D, R) and unitless sustain (0..1)
        this.attack  = attack;
        this.decay   = decay;
        this.sustain = sustain;
        this.release = release;

        // Peak gain we’ll hit at the end of the attack (headroom-friendly)
        // Keep well below 1.0 when layering voices to avoid clipping.
        this.maxGain = 0.25;

        // === Signal path nodes ===

        // Audio source: sawtooth oscillator at the target frequency
        // (type options: 'sine' | 'square' | 'sawtooth' | 'triangle' | custom PeriodicWave)
        this.osc = new OscillatorNode(this.ctx, {
            frequency: this.freq,
            type: "sawtooth"
        });

        // Amplitude envelope: a GainNode we’ll automate for ADSR
        // Start at 0 so the note is silent until start() schedules ramps.
        this.adsr = new GainNode(this.ctx, { gain: 0.0 });

        // Tone (brightness) envelope: low-pass filter with a fairly high initial cutoff
        // Q=10 gives a noticeable resonance. Starting cutoff = 8x fundamental (bright),
        // then we’ll sweep it (see start()).
        this.lpFilter = new BiquadFilterNode(this.ctx, {
            type: "lowpass",
            frequency: this.freq * 8,
            Q: 10
        });

        // Connect chain: osc → adsr (amp) → lowpass (timbre) → destination
        // connect() returns the destination node, so chaining works ergonomically.
        this.osc
            .connect(this.adsr)
            .connect(this.lpFilter)
            .connect(dest);
    }

    /**
     * MIDI note number to frequency (Hz).
     * Formula: f = 440 * 2^((m - 69)/12)
     * @param {number} mn MIDI note number
     * @returns {number} frequency in Hz
     */
    mtof(mn) {
        return 440 * 2 ** ((mn - 69) / 12);
    }

    /**
     * Clear any scheduled automation and "pin" current values
     * so new ramps start from the current instantaneous state.
     * This avoids clicks or discontinuities when retriggering.
     *
     * @param {number} t AudioContext time (seconds) to anchor at (usually ctx.currentTime)
     */
    resetEnvelopes(t) {
        // Amplitude envelope: cancel future automation…
        this.adsr.gain.cancelScheduledValues(t);
        // …and set a new starting point at the current value to prevent jumps.
        this.adsr.gain.setValueAtTime(this.adsr.gain.value, t);

        // Filter envelope: same idea for cutoff frequency
        this.lpFilter.frequency.cancelScheduledValues(t);
        this.lpFilter.frequency.setValueAtTime(this.lpFilter.frequency.value, t);
    }

    /**
     * Start (trigger) the note:
     * - Resets envelopes to avoid clicks
     * - What is missing?
     * - Schedules ADS (amp) and filter sweeps
     */
    start() {
        const now = this.ctx.currentTime;

        // Ensure a clean starting point for both envelopes
        this.resetEnvelopes(now);



        // === Amplitude ADS ===
        // A: ramp up to maxGain over 'attack' seconds
        this.adsr.gain.linearRampToValueAtTime(this.maxGain, now + this.attack);

        // D: then ramp down to (maxGain * sustain) over additional 'decay' seconds
        // Because we provide a later time, the ramp continues piecewise from the attack result.
        this.adsr.gain.linearRampToValueAtTime(
            this.maxGain * this.sustain,
            now + this.attack + this.decay
        );

        // === Filter "envelope" (simple 1-segment sweep here) ===
        // Sweep cutoff toward 2×fundamental by the end of A+D — i.e., bright → darker.
        // (You could add a separate filter sustain/release if you want symmetry with ADSR.)
        this.lpFilter.frequency.linearRampToValueAtTime(
            this.freq * 2,
            now + this.attack + this.decay
        );
    }

    /**
     * Release (stop) the note:
     * - Resets envelopes (anchors from current values)
     * - Schedules release on amplitude
     * - Stops oscillator after release time
     */
    stop() {
        const now = this.ctx.currentTime;

        // Anchor from current values to avoid discontinuous jumps
        this.resetEnvelopes(now);

        // === Amplitude R ===
        // Likely intent: ramp to 0 over 'release' seconds, then stop the osc.
        this.adsr.gain.linearRampToValueAtTime(0.0, now + this.release);

        // Stop oscillator right when the envelope hits 0.
        this.osc.stop(now + this.release);
    }
}
