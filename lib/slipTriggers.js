// #13 — Sugar slip triggers. A slip's reason is stored in the existing
// `reason` text column; the chips below write one of these labels.
// Labels match the reasons the Sugar page has always offered, so slips you
// logged before keep counting.
export const TRIGGERS = [
  { id: "stress", label: "Stress", emoji: "😣" },
  { id: "social", label: "Social occasion", emoji: "🎉" },
  { id: "craving", label: "Craving", emoji: "🍫" },
  { id: "late", label: "Late night", emoji: "🌙" },
  { id: "tired", label: "Tiredness", emoji: "😴" },
  { id: "bored", label: "Bored", emoji: "🥱" },
  { id: "travel", label: "Travel", emoji: "✈️" },
  { id: "other", label: "Other", emoji: "🤷" },
];

export function triggerOf(reason) {
  const r = String(reason || "").toLowerCase();
  return TRIGGERS.find((t) => r === t.label.toLowerCase() || r.includes(t.id)) || null;
}

// { total, byTrigger: [{ ...trigger, count, pct }], untagged, headline }
export function analyseSlips(days) {
  const slips = days.filter((d) => d.completed === false);
  const counts = {};
  let untagged = 0;
  for (const d of slips) {
    const t = triggerOf(d.reason);
    if (t) counts[t.id] = (counts[t.id] || 0) + 1;
    else untagged++;
  }
  const tagged = slips.length - untagged;
  const byTrigger = TRIGGERS.map((t) => ({ ...t, count: counts[t.id] || 0, pct: tagged ? Math.round(((counts[t.id] || 0) / tagged) * 100) : 0 }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);
  const top = byTrigger[0];
  const headline = top && tagged >= 3 ? `${top.pct}% of your slips come from "${top.label.toLowerCase()}".` : null;
  return { total: slips.length, tagged, untagged, byTrigger, headline };
}
