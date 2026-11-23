// Language (English / తెలుగు / हिन्दी), phase 1: the bottom bar and the Me
// page. Strings are keyed by their English text, so anything not yet
// translated simply stays English. Chosen per device.
import { useEffect, useState } from "react";

export const LANGS = [["en", "English"], ["te", "తెలుగు"], ["hi", "हिन्दी"]];
const KEY = "app_lang";
const EVENT = "app:lang";

const T = {
  te: {
    Home: "హోమ్", Insights: "విశ్లేషణ", Movies: "సినిమాలు", Me: "నేను", "Add an expense": "ఖర్చు జోడించండి",
    "No-sugar challenge": "చక్కెర లేని ఛాలెంజ్", "Mini challenges": "చిన్న ఛాలెంజ్‌లు", "Budget & goals": "బడ్జెట్ & లక్ష్యాలు",
    "Balance & transactions": "బ్యాలెన్స్ & లావాదేవీలు", "Accounts & cards": "ఖాతాలు & కార్డులు", "Net worth": "నికర ఆస్తి",
    "Loans & EMIs": "రుణాలు & EMIలు", "Trips & events": "ప్రయాణాలు & వేడుకలు", "Tax deductions": "పన్ను మినహాయింపులు",
    Habits: "అలవాట్లు", Health: "ఆరోగ్యం", Diet: "ఆహారం", Medical: "వైద్యం", Goals: "లక్ష్యాలు", Journal: "డైరీ", Wishlist: "కోరికల జాబితా",
    "Home upkeep": "ఇంటి నిర్వహణ", "Renewals & documents": "రెన్యూవల్స్ & పత్రాలు", Vehicles: "వాహనాలు", People: "వ్యక్తులు",
    "Who owes what": "ఎవరు ఎవరికి బాకీ", Shows: "షోలు", "Shared spaces": "షేర్డ్ స్పేస్‌లు", Search: "వెతకండి", Pause: "ఆగండి", Settings: "సెట్టింగ్‌లు",
    Money: "డబ్బు", "Health & life": "ఆరోగ్యం & జీవితం", "Home & people": "ఇల్లు & వ్యక్తులు", "More": "మరిన్ని",
  },
  hi: {
    Home: "होम", Insights: "जानकारी", Movies: "फ़िल्में", Me: "मैं", "Add an expense": "खर्च जोड़ें",
    "No-sugar challenge": "बिना चीनी चुनौती", "Mini challenges": "छोटी चुनौतियाँ", "Budget & goals": "बजट और लक्ष्य",
    "Balance & transactions": "बैलेंस और लेन-देन", "Accounts & cards": "खाते और कार्ड", "Net worth": "कुल संपत्ति",
    "Loans & EMIs": "लोन और EMI", "Trips & events": "यात्राएँ और कार्यक्रम", "Tax deductions": "टैक्स छूट",
    Habits: "आदतें", Health: "सेहत", Diet: "आहार", Medical: "चिकित्सा", Goals: "लक्ष्य", Journal: "डायरी", Wishlist: "इच्छा सूची",
    "Home upkeep": "घर की देखभाल", "Renewals & documents": "नवीनीकरण और दस्तावेज़", Vehicles: "वाहन", People: "लोग",
    "Who owes what": "किसका कितना बकाया", Shows: "शो", "Shared spaces": "साझा खाते", Search: "खोजें", Pause: "रुकें", Settings: "सेटिंग्स",
    Money: "पैसा", "Health & life": "सेहत और जीवन", "Home & people": "घर और लोग", "More": "और",
  },
};

export function translate(lang, s) {
  return (T[lang] && T[lang][s]) || s;
}
export function getLang() {
  try { return localStorage.getItem(KEY) || "en"; } catch { return "en"; }
}
export function setLang(lang) {
  try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  window.dispatchEvent(new Event(EVENT));
}
// English on the first (server-matching) render, then the chosen language.
export function useT() {
  const [lang, setL] = useState("en");
  useEffect(() => {
    const sync = () => setL(getLang());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return { lang, t: (s) => translate(lang, s) };
}
