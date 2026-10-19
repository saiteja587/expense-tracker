import { Utensils, ShoppingBasket, Bus, Receipt, Home, ShoppingBag, HeartPulse, Ticket, Clapperboard, Tag, Sparkles } from "lucide-react";

const ICONS = {
  Food: Utensils,
  Groceries: ShoppingBasket,
  Transport: Bus,
  Bills: Receipt,
  Rent: Home,
  Shopping: ShoppingBag,
  Health: HeartPulse,
  Entertainment: Ticket,
  Movies: Clapperboard,
  Other: Sparkles,
};

// A round icon in the category's own colour with a soft glossy sheen —
// replaces the plain coloured dot in lists. Custom categories get a tag.
export default function CategoryIcon({ category, color, size = 34 }) {
  const Icon = ICONS[category] || Tag;
  return (
    <span
      className="cat-icon"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(145deg, rgba(255,255,255,0.32), rgba(255,255,255,0) 55%), ${color || "#6B6558"}`,
      }}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </span>
  );
}
