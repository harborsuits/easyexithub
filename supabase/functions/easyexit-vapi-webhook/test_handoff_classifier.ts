/**
 * Handoff Classifier v1 — Test Cases
 * Run: deno run test_handoff_classifier.ts
 */

// Inline the classifier for isolated testing
interface HandoffClassification {
  priority: "hot_interest" | "warm_interest" | "manual_review" | null;
  triggerPhrase: string | null;
}

function classifyHandoff(transcript: string): HandoffClassification {
  const text = transcript.toLowerCase();

  const negatives = [
    "do not call", "wrong number", "wrong person", "not interested",
    "take me off", "stop calling", "deceased", "passed away", "do not contact",
  ];
  for (const phrase of negatives) {
    if (text.includes(phrase)) return { priority: null, triggerPhrase: null };
  }

  const hot = [
    "i'd consider selling", "i would consider selling", "what would you offer",
    "make an offer", "make me an offer", "i've thought about selling",
    "i have thought about selling", "yes maybe", "how does this work",
    "what's the process", "send me an offer", "i'm open to it", "i am open to it",
    "let's talk numbers", "what kind of offer", "i'd sell for the right price",
    "i would sell for the right price",
  ];
  for (const phrase of hot) {
    if (text.includes(phrase)) return { priority: "hot_interest", triggerPhrase: phrase };
  }

  const warm = [
    "call me back", "tell me more", "send me something", "depends on price",
    "depends on the price", "maybe someday", "not right now but",
    "thinking about it", "been thinking about", "possibly", "might consider",
    "send me info", "send information",
  ];
  for (const phrase of warm) {
    if (text.includes(phrase)) return { priority: "warm_interest", triggerPhrase: phrase };
  }

  if (text.includes("offer") || text.includes("sell") || text.includes("callback")) {
    return { priority: "manual_review", triggerPhrase: "soft_intent_signal" };
  }

  return { priority: null, triggerPhrase: null };
}

// =====================================================================
// Test Cases
// =====================================================================

const tests: Array<{
  name: string;
  transcript: string;
  expected: { priority: string | null; shouldMatch?: string };
}> = [
  // 1. HOT — owner directly asks about selling
  {
    name: "HOT: Owner asks what you'd offer",
    transcript:
      "Hi, this is Alex from Easy Exit Homes. I'm calling about your property on 45 Maple Street. " +
      "Oh yeah, I've been getting some letters. What would you offer for it? " +
      "I've been thinking about downsizing.",
    expected: { priority: "hot_interest", shouldMatch: "what would you offer" },
  },

  // 2. WARM — wants a callback, not committing
  {
    name: "WARM: Owner wants a callback",
    transcript:
      "I can't talk right now, I'm at work. Can you call me back later this evening? " +
      "I'd like to hear more about what you're doing.",
    expected: { priority: "warm_interest", shouldMatch: "call me back" },
  },

  // 3. NEGATIVE — explicit DNC
  {
    name: "NEGATIVE: DNC request",
    transcript:
      "I don't want to sell. Please do not call me again. Take me off your list.",
    expected: { priority: null },
  },

  // 4. MANUAL_REVIEW — soft signal, mentions selling but ambiguously
  {
    name: "MANUAL_REVIEW: Soft signal about selling",
    transcript:
      "My mother used to live there. She's in a nursing home now. " +
      "I'm not sure we want to sell but we might need to. It's a lot to maintain.",
    expected: { priority: "manual_review", shouldMatch: "soft_intent_signal" },
  },

  // 5. NO TRIGGER — pure voicemail / no engagement from the lead
  {
    name: "NO TRIGGER: Voicemail left by agent, no lead response",
    transcript:
      "Hi, this is Alex calling from Easy Exit Homes about your property. " +
      "I'd love to chat when you have a moment. Please give us a call back at your convenience. Thank you!",
    expected: { priority: null },
  },

  // 6. HOT: "I'm open to it" + "how does this work" (both hot — first match wins)
  {
    name: "HOT: Owner says open to it",
    transcript:
      "Yeah I got your letter. The house needs a lot of work and I'm getting older. " +
      "I'm open to it if the price is right. How does this work exactly?",
    expected: { priority: "hot_interest", shouldMatch: "how does this work" },
  },

  // 7. NEGATIVE: Wrong number
  {
    name: "NEGATIVE: Wrong number",
    transcript: "I don't own any property. You have the wrong number.",
    expected: { priority: null },
  },
];

// Run tests
let passed = 0;
let failed = 0;

for (const t of tests) {
  const result = classifyHandoff(t.transcript);
  const ok = result.priority === t.expected.priority;
  const matchOk =
    !t.expected.shouldMatch || result.triggerPhrase === t.expected.shouldMatch;

  if (ok && matchOk) {
    console.log(`✅ ${t.name}`);
    passed++;
  } else {
    console.log(`❌ ${t.name}`);
    console.log(`   Expected: priority=${t.expected.priority}, match=${t.expected.shouldMatch || "any"}`);
    console.log(`   Got:      priority=${result.priority}, match=${result.triggerPhrase}`);
    failed++;
  }
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) Deno.exit(1);
