// #15 — Shared spaces: who owes whom, from a list of shared entries.
// Entry: { payer, amount, splitWith: [names] } — split equally among
// splitWith (which includes the payer if they share the cost).

export function balances(members, entries) {
  const net = Object.fromEntries(members.map((m) => [m, 0]));
  for (const e of entries) {
    const among = (e.splitWith && e.splitWith.length ? e.splitWith : members).filter((m) => m in net);
    if (!among.length || !(e.payer in net)) continue;
    const share = e.amount / among.length;
    net[e.payer] += e.amount;
    for (const m of among) net[m] -= share;
  }
  for (const m of members) net[m] = Math.round(net[m] * 100) / 100;
  return net;
}

// Fewest transfers to settle up: [{ from, to, amount }].
export function settleUp(net) {
  const debtors = Object.entries(net).filter(([, v]) => v < -0.009).map(([n, v]) => ({ n, v: -v })).sort((a, b) => b.v - a.v);
  const creditors = Object.entries(net).filter(([, v]) => v > 0.009).map(([n, v]) => ({ n, v })).sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].v, creditors[j].v);
    out.push({ from: debtors[i].n, to: creditors[j].n, amount: Math.round(amt * 100) / 100 });
    debtors[i].v -= amt;
    creditors[j].v -= amt;
    if (debtors[i].v < 0.01) i++;
    if (creditors[j].v < 0.01) j++;
  }
  return out;
}
