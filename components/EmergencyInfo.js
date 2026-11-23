// Lock screen → "🆘 Emergency info": the emergency card saved on THIS phone
// (copied when you open Medical → Emergency card). It never calls the
// server, so it works without the PIN and offline.
import { useEffect, useState } from "react";

export const EMERGENCY_KEY = "emergency_card_v1";
const ROWS = [["bloodGroup", "🩸 Blood group"], ["allergies", "⚠️ Allergies"], ["conditions", "Conditions"], ["medicines", "💊 Medicines"], ["insurer", "🛡️ Insurer"], ["policyNo", "Policy no."], ["note", "Note"]];

export default function EmergencyInfo() {
  const [card, setCard] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { setCard(JSON.parse(localStorage.getItem(EMERGENCY_KEY) || "null")); } catch { setCard(null); }
  }, []);
  if (!card) return null;
  const tel = (p) => `tel:${String(p).replace(/[^\d+]/g, "")}`;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={{ marginTop: 14, background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger)", borderRadius: 999, padding: "8px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
        🆘 Emergency info
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Emergency information" style={{ position: "fixed", inset: 0, background: "var(--bg)", zIndex: 1000, overflowY: "auto", padding: "28px 20px", textAlign: "left" }}>
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>Emergency information</div>
            {card.name && <div className="lora" style={{ fontSize: 26, fontWeight: 700, margin: "4px 0 12px" }}>{card.name}</div>}
            {ROWS.filter(([k]) => card[k]).map(([k, l]) => (
              <div key={k} style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{l}</div>
                <div style={{ fontSize: k === "bloodGroup" ? 26 : 17, fontWeight: k === "bloodGroup" ? 800 : 500 }}>{card[k]}</div>
              </div>
            ))}
            {[["contact1Name", "contact1Phone"], ["contact2Name", "contact2Phone"], ["doctorName", "doctorPhone"]].filter(([n, p]) => card[n] || card[p]).map(([n, p]) => (
              <a key={n} href={card[p] ? tel(card[p]) : undefined} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", marginTop: 10, borderRadius: 14, background: "var(--success-bg)", color: "var(--ink)", textDecoration: "none" }}>
                <span><span style={{ fontSize: 12, color: "var(--muted)", display: "block" }}>{n === "doctorName" ? "Doctor" : "Emergency contact"}</span><b style={{ fontSize: 17 }}>{card[n] || card[p]}</b></span>
                {card[p] && <span style={{ fontSize: 16, fontWeight: 700, color: "var(--success)" }}>📞 {card[p]}</span>}
              </a>
            ))}
            <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 22 }} onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
