# Suffler

Teleprompter app for short videos: scripts, voice-follow prompter, take editor, and the oracle (Google Gemini with your own free key, or ChatGPT by copy and paste).

Live on GitHub Pages: https://valdekluik5-ui.github.io/V/

## "Only my voice" (Voice Clean 1.1)

The take screen's Sound → *Only my voice* and the editor's Voice tab use the method of the Voice Clean
Android app 1.1, running on the phone in a background worker (`voiceclean.js`):

1. **Neural voice filter:** RNNoise 0.2 compiled to WebAssembly (`rnnoise.wasm`, about 5.6 MB, downloaded the
   first time the switch is used) keeps what sounds like a voice; its speech detector turns down what is left
   between words.
2. **Noise-profile cleaner:** learns the background left in the pauses and removes it (log-spectral-amplitude
   gain, rumble and hiss cut).
3. **Level:** a quiet voice is raised to a normal level, with a soft limiter.

Light / Strong / Max are strengths 0.35 / 0.6 / 0.9 (the app's default is 0.6). If the worker or the
WebAssembly file cannot load, the older on-page cleaner is used. Checked against the Voice Clean Java code:
cleaner −108 dB, neural step −78 dB difference. Rebuild `rnnoise.wasm` from RNNoise 0.2
(`rnnoise_0.2+ds.orig.tar.xz`, see `voiceclean-src/`) with plain clang for wasm32 + wasm-ld;
RNNoise is BSD licensed (`voiceclean-src/RNNOISE-COPYING`).
