// Shared data and storage helpers for all pages (dashboard, vocab, chat).

const TOPICS = {
  Greetings: [
    { en: "Hello", ja: "こんにちは", ex: "Hello! My name is Ken.", say: "heh-LOH" },
    { en: "Thank you", ja: "ありがとう", ex: "Thank you for your help.", say: "THANK yoo" },
    { en: "Goodbye", ja: "さようなら", ex: "Goodbye! See you next week.", say: "good-BYE" },
    { en: "Excuse me", ja: "すみません", ex: "Excuse me, where is the station?", say: "ik-SKYOOZ mee" },
    { en: "Please", ja: "お願いします", ex: "A coffee, please.", say: "PLEEZ" },
    { en: "Good morning", ja: "おはようございます", ex: "Good morning! Did you sleep well?", say: "good MOR-ning" },
  ],
  Food: [
    { en: "Menu", ja: "メニュー", ex: "Can I see the menu, please?", say: "MEN-yoo" },
    { en: "Water", ja: "水", ex: "I would like a glass of water.", say: "WAW-ter" },
    { en: "Delicious", ja: "おいしい", ex: "This ramen is delicious!", say: "dih-LISH-us" },
    { en: "Bill", ja: "お会計", ex: "Can we have the bill, please?", say: "BIL" },
    { en: "Breakfast", ja: "朝ごはん", ex: "I eat breakfast at seven.", say: "BREK-fust" },
    { en: "Vegetables", ja: "野菜", ex: "I try to eat more vegetables.", say: "VEJ-tuh-bulz" },
    { en: "Spicy", ja: "辛い", ex: "Is this curry spicy?", say: "SPY-see" },
  ],
  Travel: [
    { en: "Ticket", ja: "切符", ex: "I need a ticket to Osaka.", say: "TIK-it" },
    { en: "Station", ja: "駅", ex: "The station is near my hotel.", say: "STAY-shun" },
    { en: "Airport", ja: "空港", ex: "How do I get to the airport?", say: "AIR-port" },
    { en: "Passport", ja: "パスポート", ex: "Please show me your passport.", say: "PASS-port" },
    { en: "Hotel", ja: "ホテル", ex: "Our hotel has a nice view.", say: "hoh-TEL" },
    { en: "Map", ja: "地図", ex: "Can you show me on the map?", say: "MAP" },
    { en: "Luggage", ja: "荷物", ex: "My luggage is very heavy.", say: "LUG-ij" },
  ],
  Business: [
    { en: "Meeting", ja: "会議", ex: "The meeting starts at ten.", say: "MEE-ting" },
    { en: "Schedule", ja: "予定", ex: "Let me check my schedule.", say: "SKEJ-ool" },
    { en: "Deadline", ja: "締め切り", ex: "The deadline is next Friday.", say: "DED-line" },
    { en: "Colleague", ja: "同僚", ex: "This is my colleague, Ms. Sato.", say: "KOL-eeg" },
    { en: "Business card", ja: "名刺", ex: "Here is my business card.", say: "BIZ-nis kard" },
    { en: "Presentation", ja: "プレゼンテーション", ex: "I will give a presentation today.", say: "prez-un-TAY-shun" },
    { en: "Agreement", ja: "合意", ex: "We reached an agreement.", say: "uh-GREE-ment" },
  ],
};

const KEYS = {
  vocab: "sensei-vocab-progress",        // { "Topic::Word": "know" | "learning" }
  tab: "sensei-vocab-tab",               // last opened vocab topic
  conversations: "sensei-conversations", // number of chat sessions
  days: "sensei-activity-days",          // ["YYYY-MM-DD", ...] days with any activity
  lastTopic: "sensei-last-topic",        // { topic: "Food", at: <timestamp> } last topic with a rated card
  theme: "sensei-theme",                 // "light" | "dark" (also read by the small script in each page's <head>)
};

// localStorage can be blocked (private mode, strict settings) — never let that break a page.
const Store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  },
};

const wordId = (topic, word) => topic + "::" + word.en;

function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Call whenever the student does something (rates a card, gets a chat reply).
function recordActivity() {
  const days = Store.get(KEYS.days, []);
  const today = dayKey(new Date());
  if (!days.includes(today)) {
    days.push(today);
    Store.set(KEYS.days, days.slice(-400));
  }
}

// Call when the student rates a vocab card ("Know It" or "Still Learning").
function recordStudiedTopic(topic) {
  Store.set(KEYS.lastTopic, { topic, at: Date.now() });
}

// The last studied vocab topic, if it was studied within the last `maxDays` days.
function recentTopic(maxDays = 7) {
  const last = Store.get(KEYS.lastTopic, null);
  if (!last || !TOPICS[last.topic] || typeof last.at !== "number") return null;
  if (Date.now() - last.at > maxDays * 24 * 60 * 60 * 1000) return null;
  return last.topic;
}

function countConversation() {
  Store.set(KEYS.conversations, (Number(Store.get(KEYS.conversations, 0)) || 0) + 1);
}

// Consecutive active days. The streak stays alive until the end of today,
// so if the student was active yesterday but not yet today, it still counts.
function dayStreak() {
  const days = new Set(Store.get(KEYS.days, []));
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function topicStats() {
  const progress = Store.get(KEYS.vocab, {});
  return Object.keys(TOPICS).map(name => {
    const words = TOPICS[name];
    const known = words.filter(w => progress[wordId(name, w)] === "know").length;
    return { name, known, total: words.length };
  });
}

// ---------- Dark mode toggle ----------
// The theme itself is set early by a small script in each page's <head>; this wires up the buttons.
function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function updateThemeButtons() {
  const dark = currentTheme() === "dark";
  document.querySelectorAll(".theme-toggle").forEach(btn => {
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    btn.setAttribute("aria-pressed", String(dark));
    btn.title = dark ? "Light mode" : "Dark mode";
  });
}

document.querySelectorAll(".theme-toggle").forEach(btn => {
  btn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    Store.set(KEYS.theme, next);
    updateThemeButtons();
  });
});
updateThemeButtons();

// ---------- Offline support (PWA) ----------
// Service workers only run on https:// or http://localhost, not when a file is opened directly.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(err => console.warn("Service worker not registered:", err));
  });
}
