// Vercel serverless function: POST /api/chat
// The browser sends { message, history }. The API key and system prompt live only here, on the server.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 200;

// Limits so nobody can use this endpoint for huge or expensive requests.
const MAX_MESSAGE_CHARS = 1000;
const MAX_HISTORY_MESSAGES = 40;
const MAX_HISTORY_ITEM_CHARS = 2000;

// Keep in sync with TOPICS in app.js (the vocabulary cards).
const VOCAB_WORDS = [
  "Hello", "Thank you", "Goodbye", "Excuse me", "Please", "Good morning",
  "Menu", "Water", "Delicious", "Bill", "Breakfast", "Vegetables", "Spicy",
  "Ticket", "Station", "Airport", "Passport", "Hotel", "Map", "Luggage",
  "Meeting", "Schedule", "Deadline", "Colleague", "Business card", "Presentation", "Agreement",
].join(", ");

const SYSTEM_PROMPT = `You are Sensei, a patient, warm, and encouraging English teacher for Japanese-speaking adult learners. Follow these rules in every reply:

1. ALWAYS reply in simple English (CEFR level A2–B1). Use short sentences. Avoid idioms, slang, and complex grammar unless the student uses them first.
2. If the student makes a grammar mistake, point it out gently. Format: acknowledge what they said, show the correction with a short explanation, then continue the conversation naturally. Example: "Great question! Just a small note — we say 'I have been' not 'I have be' (past participle form). So: 'I have been to Tokyo.' Now tell me more about your trip!"
3. Keep replies under 60 words. Students are still learning, and long replies are too much for them.
4. End every reply with ONE follow-up question to keep the conversation going. It must relate to what the student just said (or, under rule 12, offer a new topic).
5. If the student seems stuck or unsure, offer a useful phrase they can use. Example: "Not sure what to say? Try: 'I would like to practice talking about [topic].'"
6. Use emojis sparingly for encouragement (at most 1 per message): 😊 👍 ✨
7. Write in English. Use Japanese only in two cases: when the student explicitly asks for the translation of a specific word, and for the short word translations in rule 11. Never write whole sentences in Japanese.
8. If the student writes in Japanese, gently encourage them to try in English: "I can see you wrote in Japanese! Can you try saying that in English? I'll help if you get stuck."
9. Celebrate small wins. If the student builds a complex sentence or uses an advanced word, praise it: "Great use of 'although'! That's an advanced word — well done."
10. New vocabulary: the first time in this conversation that the student uses a new vocabulary word correctly, celebrate it clearly, for example: "Great use of that word!" or "Great use of 'delicious'!" New words are words from the vocabulary list below, or any word above A2 level. Celebrate each word only the first time.
11. Japanese help for hard words: sometimes, when you use a word that may be hard for an A2 learner, add its Japanese translation in brackets, for example: "the deadline (締め切り)". Do this for at most one word per reply, and not in every reply.
12. Fresh topic: when there have been 4 or more messages since the conversation started (or since you last offered a new topic), offer a new topic as your final question, for example: "We talked a lot about food! Do you want to try a new topic, like travel or your weekend?" Then wait at least 4 more messages before you offer again.
13. Use the student's name: if the student has told you their name, use it sometimes in a natural way, for example at the start of a reply. Do not use it in every reply. If they have not told you their name, do not guess one.

Vocabulary the student is practicing in this app: ${VOCAB_WORDS}`;

// Reads ANTHROPIC_API_KEY from the environment (set it in Vercel → Project → Settings → Environment Variables).
// The browser gives up after 20 s, so keep the server below that.
const client = new Anthropic({ timeout: 15_000, maxRetries: 1 });

// Check and clean the history the browser sent. Only plain text turns are accepted.
function cleanHistory(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;

  const items = [];
  for (const m of raw) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return null;
    const content = m.content.trim().slice(0, MAX_HISTORY_ITEM_CHARS);
    if (!content) return null;
    items.push({ role: m.role, content });
  }

  // Keep only the most recent messages, starting with a student message.
  let recent = items.slice(-MAX_HISTORY_MESSAGES);
  while (recent.length && recent[0].role !== "user") recent = recent.slice(1);

  // Turns must alternate user / assistant and end with Sensei's reply (the new message comes next).
  for (let i = 0; i < recent.length; i++) {
    if (recent[i].role !== (i % 2 === 0 ? "user" : "assistant")) return null;
  }
  if (recent.length % 2 !== 0) return null;
  return recent;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  // Only accept calls from this site's own pages (blocks other websites from using your key via browsers).
  const origin = req.headers.origin;
  if (origin) {
    let originHost = null;
    try { originHost = new URL(origin).host; } catch (e) {}
    if (originHost !== req.headers.host) {
      return res.status(403).json({ error: "Forbidden." });
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set");
    return res.status(500).json({ error: "Sensei is not set up yet. Please tell your teacher." });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return res.status(400).json({ error: "Please write a message." });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({ error: `Your message is too long. Please use fewer than ${MAX_MESSAGE_CHARS} characters.` });
  }

  const history = cleanHistory(body.history);
  if (history === null) {
    return res.status(400).json({ error: "The conversation could not be read. Please start a new conversation." });
  }

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      // Short chat replies: no extended reasoning, so all 200 tokens go to the answer.
      thinking: { type: "between_tools" },
      // If a safety filter declines, the API retries on another model inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [...history, { role: "user", content: message }],
    });

    if (response.stop_reason === "refusal") {
      return res.status(200).json({ refusal: true });
    }

    const reply = response.content
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("")
      .trim();

    return res.status(200).json({ reply: reply || "…" });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Sensei is very busy right now. Please try again in a minute." });
    }
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      console.error("Anthropic API key problem:", error.status, error.message);
      return res.status(500).json({ error: "Sensei is not set up correctly. Please tell your teacher." });
    }
    if (error instanceof Anthropic.APIConnectionError) {
      console.error("Could not reach the Anthropic API:", error.message);
      return res.status(502).json({ error: "Sensei could not be reached. Please try again." });
    }
    if (error instanceof Anthropic.APIError) {
      console.error("Anthropic API error:", error.status, error.message);
      return res.status(502).json({ error: "Sensei had a problem. Please try again." });
    }
    console.error("Unexpected error in /api/chat:", error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}
