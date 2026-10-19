// Accent themes. Each one is just three CSS variables on <html>; everything
// that uses the signature gradient (buttons, title, nav highlight, rings,
// glow) reads those variables, so switching theme restyles the whole app
// instantly with no per-page code.
export const THEMES = {
  sunset: {
    label: "Sunset",
    gradient: "linear-gradient(135deg, #FF8A3D 0%, #F0457B 38%, #9B3FD0 72%, #4F6BED 100%)",
    solid: "#D63C78",
    rgb: "214, 60, 120",
  },
  ocean: {
    label: "Ocean",
    gradient: "linear-gradient(135deg, #22D3EE 0%, #3B82F6 42%, #6366F1 72%, #8B5CF6 100%)",
    solid: "#2F6FE0",
    rgb: "47, 111, 224",
  },
  forest: {
    label: "Forest",
    gradient: "linear-gradient(135deg, #A3E635 0%, #22C55E 38%, #0D9488 72%, #0EA5E9 100%)",
    solid: "#16A34A",
    rgb: "22, 163, 74",
  },
  berry: {
    label: "Berry",
    gradient: "linear-gradient(135deg, #F472B6 0%, #D946EF 38%, #8B5CF6 72%, #4338CA 100%)",
    solid: "#C026D3",
    rgb: "192, 38, 211",
  },
};

const KEY = "accentTheme";

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return THEMES[t] ? t : "sunset";
  } catch {
    return "sunset";
  }
}

export function applyTheme(name) {
  const t = THEMES[name] || THEMES.sunset;
  const root = document.documentElement;
  root.style.setProperty("--accent-gradient", t.gradient);
  root.style.setProperty("--accent-solid", t.solid);
  root.style.setProperty("--accent-rgb", t.rgb);
  root.setAttribute("data-accent", THEMES[name] ? name : "sunset");
}

export function saveTheme(name) {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // ignore
  }
  applyTheme(name);
}
