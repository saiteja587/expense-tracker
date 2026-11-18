// Turn a pasted bank / UPI SMS (or a typed sentence like "250 swiggy") into
// a draft expense: { amount, note, category, isCredit }.
//
// Handles the common Indian formats, e.g.
//   "Rs.250.00 debited from A/c XX1234 on 18-11-26 to VPA swiggy@icici"
//   "INR 1,240 spent on HDFC Bank Card XX12 at BIG BAZAAR on 2026-11-17"
//   "Sent Rs.40 From HDFC Bank A/C *1234 To CHAI POINT On 18/11/26"
//   "You have paid ₹180 to Ravi via GPay"
// and refuses obvious non-spends (OTPs, credits) so nothing wrong is logged.

// Word boundaries (\b) matter: without them "Ravi " matched the telecom
// brand "Vi" and a payment to a friend was filed under Bills.
const MERCHANT_CATEGORIES = [
  [/swiggy|zomato|domino|pizza|\bkfc\b|mcdonald|burger|restaurant|\bcafe|\bchai\b|\btea\b|biryani|\bfood|eatclub|starbucks|bakery/i, "Food"],
  [/bigbasket|big ?bazaar|blinkit|zepto|instamart|dmart|grocer|kirana|more retail|reliance fresh|jiomart|supermarket/i, "Groceries"],
  [/\buber\b|\bola\b|rapido|\bmetro\b|irctc|redbus|petrol|\bfuel|hpcl|bpcl|indian ?oil|fastag|\bauto\b|\bcab\b/i, "Transport"],
  [/airtel|\bjio\b|vodafone|\bvi\b|bescom|electricity|tneb|water bill|broadband|act fibernet|recharge|\bgas\b|\blpg\b|\bbill\b/i, "Bills"],
  [/amazon|flipkart|myntra|ajio|meesho|nykaa|croma|decathlon|\bshop/i, "Shopping"],
  [/pharm|apollo|medplus|\b1mg\b|netmeds|hospital|clinic|doctor|\blab\b/i, "Health"],
  [/bookmyshow|\bpvr\b|\binox\b|cinepolis|netflix|hotstar|spotify|prime video|\bmovie/i, "Entertainment"],
  [/\brent\b|landlord|nobroker/i, "Rent"],
];

export function guessCategory(text) {
  for (const [re, cat] of MERCHANT_CATEGORIES) if (re.test(text)) return cat;
  return null;
}

function cleanMerchant(raw) {
  return raw
    .replace(/@[\w.]+/, "") // UPI handle suffix
    .replace(/[._-]+/g, " ")
    .replace(/\b(vpa|upi|ref|txn|on|via|a\/c|ac)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 40);
}

export function parseExpenseText(input) {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (/\b(otp|one time password|verification code)\b/i.test(text)) return null;

  const isCredit = /\b(credited|received|refund|cashback|deposited)\b/i.test(text) && !/\b(debited|spent|paid|sent)\b/i.test(text);

  // Amount: prefer one tagged with a currency marker.
  const tagged = text.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
  const bare = text.match(/(?:^|\s)([\d,]+(?:\.\d{1,2})?)(?=\s|$)/);
  const raw = (tagged || bare)?.[1];
  const amount = raw ? parseFloat(raw.replace(/,/g, "")) : NaN;
  if (!amount || amount <= 0) return null;

  let merchant = "";
  // A bank SMS always tags the amount (Rs/INR/₹). Without a tag it's a typed
  // sentence like "120 uber to office": keep the whole rest as the note.
  if (tagged) {
    const m =
      text.match(/\b(?:to|at|towards)\s+(?:vpa\s+)?([A-Za-z0-9@._& -]{2,60}?)(?=\s+(?:on|via|ref|upi|using|from|avl|avail)\b|[.,]|$)/i) ||
      text.match(/\bpaid\s+(?:rs\.?|inr|₹)?\s*[\d,.]+\s+to\s+([A-Za-z0-9@._& -]{2,60})/i);
    if (m) merchant = cleanMerchant(m[1]);
  } else {
    merchant = text.replace(raw, "").replace(/\b(rs|rupees?|inr|for|on|spent|paid)\b/gi, "").replace(/\s+/g, " ").trim().slice(0, 40);
  }

  return {
    amount,
    note: merchant,
    category: guessCategory(`${merchant} ${text}`),
    isCredit,
  };
}
