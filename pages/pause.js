"use client";

import { useState, useRef } from "react";
import { ArrowLeft } from "lucide-react";

const MESSAGES = [
  "Pause. This feeling is temporary — it will pass in a few minutes whether you act on it or not.",
  "Step away from the screen. Drink some water. Come back in five minutes if you still want to.",
  "You don't owe this moment anything. Let it pass.",
  "Notice the urge without following it. It's just a feeling — it will fade.",
  "Stand up. Stretch. Breathe. This isn't an emergency, even though it feels like one.",
  "You've paused before and gotten through it. You can do it again.",
];

function playInterruptSound(audioCtx) {
  // As loud and sharp as the Web Audio API allows — full gain, harsher waveform,
  // layered tones per hit for more perceived volume. Actual physical loudness
  // still depends on your device's own volume level, which no website can override.
  const patterns = [
    [660, 880, 990],
    [440, 550, 330],
    [523, 659, 784, 523],
    [800, 400, 800],
    [988, 988, 988],
  ];
  const pattern = patterns[Math.floor(Math.random() * patterns.length)];
  const master = audioCtx.createGain();
  master.gain.value = 1.0;
  master.connect(audioCtx.destination);

  let t = audioCtx.currentTime;
  pattern.forEach((freq) => {
    // Two layered oscillators per hit (fundamental + octave) for extra loudness/edge.
    [freq, freq * 2].forEach((f, layerIdx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(f, t);
      const peak = layerIdx === 0 ? 0.9 : 0.5;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.3);
    });
    t += 0.32;
  });
}

export default function PausePage() {
  const [message, setMessage] = useState(null);
  const [breathing, setBreathing] = useState(false);
  const audioCtxRef = useRef(null);

  function handlePause() {
    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    playInterruptSound(audioCtxRef.current);
    setMessage(MESSAGES[Math.floor(Math.random() * MESSAGES.length)]);
    setBreathing(true);
  }

  return (
    <div className="page-container" style={{ maxWidth: 480, margin: "0 auto", padding: "40px 24px 64px", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ marginBottom: 32 }}>
        <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#8a8477", textDecoration: "none" }}>
          <ArrowLeft size={12} /> Back
        </a>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 28 }}>
        {!message ? (
          <>
            <div className="lora" style={{ fontSize: 20, fontWeight: 600, color: "#241F1A" }}>
              Need a moment?
            </div>
            <div style={{ fontSize: 13, color: "#8a8477", maxWidth: 320 }}>
              Tap below. A sound will interrupt the moment, and something to read will come up. Nothing here is saved or tracked.
            </div>
            <button
              onClick={handlePause}
              style={{
                width: 160, height: 160, borderRadius: "50%", background: "#241F1A", color: "#FBF8F2",
                border: "none", fontSize: 15, fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 20px rgba(36,31,26,0.25)",
              }}
            >
              Pause
            </button>
          </>
        ) : (
          <>
            <div
              style={{
                width: 90, height: 90, borderRadius: "50%", border: "2px solid #A34A38",
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: breathing ? "pauseBreathe 4s ease-in-out infinite" : "none",
              }}
            >
              <span style={{ fontSize: 12, color: "#A34A38" }}>breathe</span>
            </div>
            <div className="lora" style={{ fontSize: 18, fontWeight: 600, color: "#241F1A", maxWidth: 340, lineHeight: 1.5 }}>
              {message}
            </div>
            <button
              onClick={handlePause}
              style={{ background: "#EAE5D9", color: "#241F1A", border: "none", borderRadius: 3, padding: "10px 18px", fontSize: 13, cursor: "pointer" }}
            >
              Again
            </button>
          </>
        )}
      </div>

      <style jsx>{`
        @keyframes pauseBreathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.25); }
        }
      `}</style>
    </div>
  );
}
