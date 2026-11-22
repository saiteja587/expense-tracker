import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// The header every "Me" sub-page uses: back link, title, one-line intro.
export default function PageHeader({ back = "/me", backLabel = "Me", icon, title, sub, children }) {
  return (
    <div style={{ marginBottom: 22, borderBottom: "1px solid var(--line-strong)", paddingBottom: 16 }}>
      <Link href={back} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--muted)", textDecoration: "none", marginBottom: 6 }}>
        <ArrowLeft size={13} /> {backLabel}
      </Link>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div className="lora" style={{ fontSize: 24, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          {icon} <span className="gradient-title">{title}</span>
        </div>
        {children}
      </div>
      {sub && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function Loading() {
  return <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>Loading…</div>;
}

export const pageStyle = { maxWidth: 680, margin: "0 auto", padding: "32px 20px 100px" };

export function Stat({ label, value, tone, sub }) {
  const bg = tone === "good" ? "var(--success-bg)" : tone === "bad" ? "var(--danger-bg)" : "var(--surface-2)";
  const color = tone === "good" ? "var(--success)" : tone === "bad" ? "var(--danger)" : "var(--ink)";
  return (
    <div className="panel-soft" style={{ flex: 1, minWidth: 130, borderRadius: 12, padding: "12px 14px", background: bg }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div className="lora tabnum" style={{ fontSize: 21, fontWeight: 600, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{sub}</div>}
    </div>
  );
}
