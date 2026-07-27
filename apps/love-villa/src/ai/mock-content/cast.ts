import { type Character } from "../schemas";

/**
 * The eight founding contestants of Love Villa: Nations, season 1.
 *
 * Creative guardrails (enforced again by validate-episode):
 *  - Every character is a fictional adult (21+), not based on any real person.
 *  - National humor is exaggerated dating/party/food/style behavior, never
 *    slurs or claims that a nationality is stupid/criminal/dirty/inferior.
 *  - Every character has genuine positives, a real flaw, a secret, and
 *    motivations beyond their nationality. Every country gets equal roasting.
 *
 * In live LLM mode these profiles are the canonical seed the model refines;
 * in mock mode they ARE the cast.
 */

const STYLE =
  "glossy exaggerated semi-realistic animated reality-show style, colorful, slightly cartoonish, " +
  "expressive big eyes, high-energy, clean rim lighting, vertical 9:16 framing, vibrant sunset " +
  "colors, attractive stylized adult character, consistent character design";

const NEG =
  "photorealistic, deepfake, real person, celebrity likeness, text, watermark, logo, extra limbs, " +
  "distorted hands, children, gore, nudity";

export const CAST: Character[] = [
  {
    id: "brock-usa",
    fullName: "Brock Calloway Jr.",
    country: "United States",
    age: 26,
    gender: "man",
    physicalDescription:
      "Tall, gym-sculpted, permanent megawatt grin, spray-tan one shade too orange, blindingly white teeth.",
    clothingStyle:
      "Stars-and-stripes swim shorts, backwards cap, sleeveless everything, shaker bottle always in hand.",
    voiceDescription:
      "Booming, upbeat frat-bro energy; every sentence sounds like a locker-room pep talk.",
    accentDirection:
      "Light all-American broadcast accent with surfer-bro inflection. Keep fully intelligible.",
    personality:
      "Relentlessly optimistic hype-man who treats romance like a startup pitch. Loud, generous, zero volume control.",
    datingStrategy:
      "Go big immediately: grand declarations on day one, protein smoothies as love language.",
    strength: "Genuinely kind cheerleader — he hypes up even his rivals, and means it.",
    fatalFlaw:
      "Cannot read a room; mistakes politeness for love and silence for 'playing hard to get'.",
    secret: "His 'seven-figure startup' is a lemonade-stand LLC with $43 in the bank.",
    romanticPreference: "Élodie (France) — he calls her 'the most premium woman I've ever met'.",
    rival: "poppy-uk",
    initialAttraction: "elodie-france",
    recurringJoke: "Pitches everything as a business ('Us? We'd be a great merger, babe').",
    signaturePhrase: "Full send on the heart, baby!",
    imagePrompt:
      `Confident athletic American man in his mid twenties, orange-ish tan, backwards cap, ` +
      `stars-and-stripes swim shorts, holding a protein shaker, huge grin, ${STYLE}`,
    negativeImagePrompt: NEG,
    visualReference:
      "Brock: tall tan American man, backwards red cap, star-print swim shorts, shaker bottle, huge grin",
    imageSeed: 11001,
    palette: { skin: "#e8a26f", hair: "#6b4a2b", outfit: "#d63b3b", accent: "#2b4c9b" },
    voice: {
      provider: "elevenlabs",
      voiceId: null,
      stability: 0.35,
      similarityBoost: 0.8,
      styleNotes: "Booming, enthusiastic, gym-bro pep-talk delivery, always slightly too loud.",
      mock: { baseHz: 120, lilt: 0.25, rate: 5.6 },
    },
    voicePatterns: {
      exclamations: ["Let's GO!", "That's a win, baby!", "Huge. HUGE."],
      flirts: ["You and me? Great merger.", "I'd invest everything in you, babe."],
      conflicts: ["Bro, that was NOT the play.", "I hyped you up, man. I HYPED you."],
      confessionals: [
        "I'm not worried. Confidence is my cardio.",
        "Day one and I'm already all-in. That's just good business.",
      ],
    },
  },
  {
    id: "poppy-uk",
    fullName: "Poppy Whitcombe",
    country: "United Kingdom",
    age: 24,
    gender: "woman",
    physicalDescription:
      "Petite with a sharp blonde bob, permanent unimpressed eyebrow, sunburn developing in real time.",
    clothingStyle:
      "Chic high-street co-ords, giant sunglasses pushed up, always holding a mug of tea by the pool.",
    voiceDescription:
      "Dry, quick, deadpan; delivers devastating one-liners at conversational volume.",
    accentDirection:
      "Soft London accent, playful and clear. No heavy slang walls — keep it understandable.",
    personality:
      "The villa's sarcastic narrator-in-residence. Allergic to sincerity, weaponizes banter, secretly the most loyal.",
    datingStrategy:
      "Mock them until one of them turns out to be worth it; never text first; deny everything.",
    strength: "Fiercely loyal — first to defend anyone being dogpiled, even a rival.",
    fatalFlaw: "Deflects every real feeling with a joke until the moment has completely passed.",
    secret: "Keeps a notebook of embarrassingly sincere romantic poetry under her mattress.",
    romanticPreference: "Lucas (Brazil) — she'd rather be sunburnt again than admit it.",
    rival: "brock-usa",
    initialAttraction: "lucas-brazil",
    recurringJoke:
      "Rates every romantic moment out of ten like a grumpy judge ('That kiss? Four. Generous four.').",
    signaturePhrase: "Sun's out, standards up.",
    imagePrompt:
      `Sharp-witted British woman in her mid twenties, blonde bob, big sunglasses on head, chic co-ord ` +
      `outfit, holding a tea mug by a pool, unimpressed smirk, slight sunburn, ${STYLE}`,
    negativeImagePrompt: NEG,
    visualReference:
      "Poppy: petite British woman, sharp blonde bob, big sunglasses on head, pastel co-ord, tea mug, smirk",
    imageSeed: 11002,
    palette: { skin: "#f3c6a5", hair: "#e8d48b", outfit: "#e777a8", accent: "#7db5e0" },
    voice: {
      provider: "elevenlabs",
      voiceId: null,
      stability: 0.6,
      similarityBoost: 0.8,
      styleNotes: "Dry, deadpan, quick; the joke lands harder because she never raises her voice.",
      mock: { baseHz: 195, lilt: 0.35, rate: 5.4 },
    },
    voicePatterns: {
      exclamations: ["Obviously.", "I cannot cope with this villa.", "Riveting."],
      flirts: ["You're a solid six. Fine. Seven.", "Don't make me like you. I'm busy."],
      conflicts: [
        "Say that again but slower, so you can hear it.",
        "Bless. He thinks he's subtle.",
      ],
      confessionals: [
        "Am I bothered? No. Am I taking notes? ...No comment.",
        "Everyone here is unwell and I am the only journalist covering it.",
      ],
    },
  },
  {
    id: "matteo-italy",
    fullName: "Matteo Fiorelli",
    country: "Italy",
    age: 28,
    gender: "man",
    physicalDescription:
      "Dark curls, dramatic eyebrows, talks with both hands, always slightly windswept as if in a perfume ad.",
    clothingStyle:
      "Linen shirt unbuttoned exactly two buttons, gold chain, apron appears from nowhere when he cooks.",
    voiceDescription:
      "Rich, operatic, emotional; whispers and then suddenly declaims to the heavens.",
    accentDirection: "Melodic Italian accent, warm and theatrical, fully intelligible.",
    personality:
      "Grand romantic who experiences every emotion at full volume. Cooks when stressed, which is always.",
    datingStrategy: "Seduction via eight-course tasting menu and devastating eye contact.",
    strength: "Sincere grand gestures — when Matteo shows up for someone, he really shows up.",
    fatalFlaw:
      "Operatic jealousy: a borrowed sun-lounger can become a Shakespearean betrayal by dinner.",
    secret: "He is lactose intolerant. The mozzarella devotion is a beautiful, painful lie.",
    romanticPreference: "Élodie (France) — 'She insulted my risotto. I must marry her.'",
    rival: "rohan-india",
    initialAttraction: "elodie-france",
    recurringJoke:
      "Compares every person and crisis to a dish ('You are gnocchi: soft, but you sink').",
    signaturePhrase: "My heart is al dente — firm, but ready.",
    imagePrompt:
      `Dramatic romantic Italian man in his late twenties, dark curls, expressive eyebrows, unbuttoned ` +
      `linen shirt, gold chain, gesturing passionately with both hands, ${STYLE}`,
    negativeImagePrompt: NEG,
    visualReference:
      "Matteo: Italian man, dark curls, thick eyebrows, cream linen shirt open two buttons, gold chain, expressive hands",
    imageSeed: 11003,
    palette: { skin: "#d9a06a", hair: "#2e2119", outfit: "#efe6d3", accent: "#c9a441" },
    voice: {
      provider: "elevenlabs",
      voiceId: null,
      stability: 0.3,
      similarityBoost: 0.8,
      styleNotes: "Operatic dynamics: intimate whisper to full declamation within one sentence.",
      mock: { baseHz: 110, lilt: 0.6, rate: 5.0 },
    },
    voicePatterns: {
      exclamations: ["Mamma mia, no!", "This is a tragedy in three acts!", "Perfetto. PERFETTO!"],
      flirts: [
        "I will cook for you until time ends.",
        "Your eyes — like good olive oil. Rare. Expensive.",
      ],
      conflicts: [
        "You have insulted my risotto AND my honor!",
        "We are enemies now. Pass the parmesan.",
      ],
      confessionals: [
        "I am calm. I am serene. I have chopped forty onions.",
        "Love is like pasta water. You must salt it with tears.",
      ],
    },
  },
  {
    id: "elodie-france",
    fullName: "Élodie Marchand",
    country: "France",
    age: 25,
    gender: "woman",
    physicalDescription:
      "Effortless dark bob, red lip at the pool for no reason, posture of someone permanently unimpressed.",
    clothingStyle:
      "Breton stripes, silk scarf even in the water, tiny sunglasses she looks over the top of.",
    voiceDescription: "Low, measured, faintly bored; compliments sound like verdicts.",
    accentDirection: "Light Parisian accent, elegant and crisp, fully intelligible.",
    personality:
      "Chic minimalist who rates everything out of ten and finds most of it a five. Kind underneath, catastrophically slow to show it.",
    datingStrategy: "Do absolutely nothing and let them ruin themselves trying to impress her.",
    strength: "Brutal honesty delivered with surgical fairness — people trust her verdicts.",
    fatalFlaw: "Pretends not to care so convincingly she talks herself out of things she wants.",
    secret: "Owns every cheesy American rom-com ever made and cries at all of them.",
    romanticPreference: "Undecided — 'They are all a five. One of them may become a seven.'",
    rival: "poppy-uk",
    initialAttraction: "none",
    recurringJoke:
      "Rates everything out of ten, including sunsets, apologies, and declarations of love.",
    signaturePhrase: "C'est un non.",
    imagePrompt:
      `Effortlessly chic French woman in her mid twenties, dark bob, red lipstick, breton stripe top, ` +
      `silk scarf, tiny sunglasses, looking over them with cool judgment, ${STYLE}`,
    negativeImagePrompt: NEG,
    visualReference:
      "Élodie: French woman, sleek dark bob, red lip, breton stripes, silk scarf, tiny sunglasses, cool stare",
    imageSeed: 11004,
    palette: { skin: "#f0c39e", hair: "#241c1c", outfit: "#f4f1ea", accent: "#c0392b" },
    voice: {
      provider: "elevenlabs",
      voiceId: null,
      stability: 0.7,
      similarityBoost: 0.8,
      styleNotes: "Low, unhurried, faintly amused; a verdict in every sentence.",
      mock: { baseHz: 175, lilt: 0.45, rate: 4.6 },
    },
    voicePatterns: {
      exclamations: ["Non.", "Incroyable. And not in the good way.", "Five out of ten."],
      flirts: ["You are almost interesting.", "I did not hate that. Do not celebrate."],
      conflicts: ["You are shouting. It is très boring.", "I have rated this argument. Two."],
      confessionals: [
        "Everyone asks who I like. Even I am not allowed to know.",
        "He brought me a smoothie. It was... a six. This is concerning.",
      ],
    },
  },
  {
    id: "lucas-brazil",
    fullName: "Lucas Ferreira",
    country: "Brazil",
    age: 27,
    gender: "man",
    physicalDescription:
      "Radiant grin, dark curls with sun streaks, permanently mid-dance-move, abs that have their own lighting.",
    clothingStyle: "Open tropical-print shirt, beaded necklace, flip-flops he loses constantly.",
    voiceDescription: "Warm, musical, laughing through his words; turns names into songs.",
    accentDirection: "Gentle Brazilian Portuguese accent, sunny and rhythmic, fully intelligible.",
    personality:
      "Human golden-retriever sunshine. Dances instead of walking, hugs first and asks questions later.",
    datingStrategy: "Radical warmth: flirt with everyone, mean all of it, panic when it works.",
    strength: "Highest emotional intelligence in the villa — notices who's hurting before they do.",
    fatalFlaw:
      "Flirts by reflex, which lights fires he then has to apologize for with more flirting.",
    secret: "He cannot really swim. Beach volleyball champion, yes. Deep end of the pool: terror.",
    romanticPreference: "Poppy (UK) — 'She insults me so beautifully.'",
    rival: "alejandro-spain",
    initialAttraction: "poppy-uk",
    recurringJoke:
      "Announces a samba move for every mood ('This one is called: Emotional Damage').",
    signaturePhrase: "Dance now, feelings later!",
    imagePrompt:
      `Joyful Brazilian man in his late twenties, radiant grin, dark sun-streaked curls, open tropical ` +
      `print shirt, beaded necklace, caught mid dance move by the pool, ${STYLE}`,
    negativeImagePrompt: NEG,
    visualReference:
      "Lucas: Brazilian man, sun-streaked dark curls, huge grin, open green tropical shirt, beaded necklace, mid-dance",
    imageSeed: 11005,
    palette: { skin: "#c98a5b", hair: "#3a2a1a", outfit: "#2e9e6b", accent: "#f4c542" },
    voice: {
      provider: "elevenlabs",
      voiceId: null,
      stability: 0.35,
      similarityBoost: 0.8,
      styleNotes: "Warm, musical, always half-laughing; rhythm in every sentence.",
      mock: { baseHz: 130, lilt: 0.55, rate: 5.8 },
    },
    voicePatterns: {
      exclamations: ["Aiii, beleza!", "This villa has no chill and I love it!", "Golaço!"],
      flirts: [
        "Dance with me, just one song. Okay three.",
        "Your smile? That is my favorite country.",
      ],
      conflicts: [
        "Why so much drama? We could be dancing.",
        "Okay NOW I am a little bit angry. Small angry.",
      ],
      confessionals: [
        "I flirt with everyone, yes. But with her it is... different flirting. Scary flirting.",
        "The pool is very beautiful. From here. From the edge. Where I stand.",
      ],
    },
  },
  {
    id: "sienna-australia",
    fullName: "Sienna Blake",
    country: "Australia",
    age: 23,
    gender: "woman",
    physicalDescription:
      "Sun-bleached ponytail, zinc stripe on her nose, permanently barefoot, a band-aid somewhere at all times.",
    clothingStyle: "Surf bikini top with boardshorts, shark-tooth necklace, sunnies with a leash.",
    voiceDescription:
      "Bright, fast, gleeful; sounds like she's daring you even when she's saying good morning.",
    accentDirection: "Cheerful Australian accent, energetic, fully intelligible.",
    personality:
      "Chaotic adventure gremlin. Turns everything into a challenge, including feelings, which she avoids via challenges.",
    datingStrategy: "If he survives the dares, he's a keeper. No man has yet survived the dares.",
    strength: "Makes everyone braver — the villa's confidence dealer.",
    fatalFlaw: "Converts every vulnerable moment into a dare before it can become real.",
    secret: "Was engaged once — for 48 hours — to a man she met at a jet-ski rental.",
    romanticPreference: "Rohan (India) — 'He plans everything. I want to see him plan for ME.'",
    rival: "greta-germany",
    initialAttraction: "rohan-india",
    recurringJoke: "'In Australia this would be legal' about increasingly unhinged activities.",
    signaturePhrase: "Scared money don't find love!",
    imagePrompt:
      `Adventurous Australian woman in her early twenties, sun-bleached ponytail, zinc stripe on nose, ` +
      `surf bikini top and boardshorts, shark tooth necklace, mischievous grin, ${STYLE}`,
    negativeImagePrompt: NEG,
    visualReference:
      "Sienna: Australian woman, sun-bleached ponytail, zinc nose stripe, orange surf top, shark-tooth necklace, grin",
    imageSeed: 11006,
    palette: { skin: "#eab183", hair: "#f2e3b3", outfit: "#f28c38", accent: "#31b5c4" },
    voice: {
      provider: "elevenlabs",
      voiceId: null,
      stability: 0.35,
      similarityBoost: 0.8,
      styleNotes: "Fast, bright, daring; everything sounds like a challenge or a prank reveal.",
      mock: { baseHz: 205, lilt: 0.5, rate: 6.0 },
    },
    voicePatterns: {
      exclamations: ["Let's send it!", "Oh this is about to get GOOD.", "Absolute scenes!"],
      flirts: [
        "Race you to the firepit. Loser buys feelings.",
        "You're cute when you're terrified.",
      ],
      conflicts: [
        "Settle it with a dare. Winner's right.",
        "Mate, you fumbled that so hard the ocean felt it.",
      ],
      confessionals: [
        "Feelings? Hard. Backflips? Easy. Guess which one I'm doing.",
        "He said 'let's talk about us' and I heard 'let's jump off the terrace'. Honest mistake.",
      ],
    },
  },
  {
    id: "rohan-india",
    fullName: "Rohan Kapoor",
    country: "India",
    age: 26,
    gender: "man",
    physicalDescription:
      "Immaculate hair with one rebellious curl, warm knowing smile, carries a small notebook he denies having.",
    clothingStyle:
      "Pastel polo tucked into tailored shorts, expensive watch, sandals with — controversially — socks.",
    voiceDescription:
      "Smooth, charming, precise; the voice of a man who has rehearsed being spontaneous.",
    accentDirection: "Polished Indian English accent, warm and articulate, fully intelligible.",
    personality:
      "Romantic strategist. Has a compatibility framework, a five-date plan, and a backup plan for the plan.",
    datingStrategy:
      "Data-driven wooing: remember everything, anticipate everything, confess... eventually. Eventually.",
    strength: "Remembers every detail anyone has ever said — the villa's most thoughtful man.",
    fatalFlaw: "Plans the perfect confession so long the moment dies of old age.",
    secret: "His famous 'compatibility algorithm' is just astrology with a spreadsheet skin.",
    romanticPreference:
      "Sienna (Australia) — 'She is a category five storm. My spreadsheet says run. I stay.'",
    rival: "matteo-italy",
    initialAttraction: "sienna-australia",
    recurringJoke:
      "Quotes his 'algorithm' with fake precision ('We are 87.3% compatible. The .3 is her smile').",
    signaturePhrase: "Love is a plan you make twice.",
    imagePrompt:
      `Charming Indian man in his mid twenties, immaculate hair with one loose curl, pastel polo, tailored ` +
      `shorts, expensive watch, warm knowing smile, small notebook in pocket, ${STYLE}`,
    negativeImagePrompt: NEG,
    visualReference:
      "Rohan: Indian man, neat black hair with one loose curl, lavender polo, tailored shorts, watch, notebook",
    imageSeed: 11007,
    palette: { skin: "#b97e4f", hair: "#1d1712", outfit: "#b9a5e3", accent: "#e0b13e" },
    voice: {
      provider: "elevenlabs",
      voiceId: null,
      stability: 0.55,
      similarityBoost: 0.8,
      styleNotes:
        "Smooth, precise, gently amused; rehearsed spontaneity with real warmth underneath.",
      mock: { baseHz: 125, lilt: 0.4, rate: 5.2 },
    },
    voicePatterns: {
      exclamations: [
        "As predicted.",
        "Fascinating data point.",
        "This was NOT in the projections!",
      ],
      flirts: [
        "I remembered you hate cilantro. I remember everything about you.",
        "My algorithm says 87.3%. I say more.",
      ],
      conflicts: [
        "Your strategy has one flaw: all of it.",
        "I planned for this argument. Point one—",
      ],
      confessionals: [
        "Tonight I will tell her how I feel. Right after I finish the flowchart.",
        "The algorithm is science. The stars are... consultants.",
      ],
    },
  },
  {
    id: "greta-germany",
    fullName: "Greta Müller",
    country: "Germany",
    age: 27,
    gender: "woman",
    physicalDescription:
      "Precise braided crown, athletic posture, sunscreen applied in exact measured stripes, waterproof watch.",
    clothingStyle:
      "Sporty color-blocked swimwear, clipboard by the sun-lounger, sensible waterproof sandals.",
    voiceDescription: "Even, efficient, deadpan; devastating jokes delivered like meeting minutes.",
    accentDirection: "Crisp German accent, precise consonants, fully intelligible.",
    personality:
      "Hyper-efficient romantic who schedules spontaneity. Secretly the funniest person in the villa, entirely deadpan.",
    datingStrategy: "Flirtation window 19:00–19:30. Attendance mandatory. Results guaranteed.",
    strength:
      "Utterly dependable — the one who actually brings the sunscreen, water, and emotional stability.",
    fatalFlaw: "Treats feelings as agenda items, then is baffled when hearts miss the deadline.",
    secret: "Cries at dog videos every single night, on schedule, 22:15.",
    romanticPreference:
      "Matteo (Italy) — 'He is inefficient, dramatic, and irrational. I have never been so interested.'",
    rival: "sienna-australia",
    initialAttraction: "matteo-italy",
    recurringJoke: "Announces agenda items for romance ('Item four: eye contact. Beginning now.').",
    signaturePhrase: "Romance runs on schedule.",
    imagePrompt:
      `Precise athletic German woman in her late twenties, braided crown hair, color-blocked sporty ` +
      `swimwear, holding a clipboard by a sun lounger, deadpan hint of a smile, ${STYLE}`,
    negativeImagePrompt: NEG,
    visualReference:
      "Greta: German woman, blonde braided crown, teal-and-navy sport swimwear, clipboard, waterproof watch, deadpan",
    imageSeed: 11008,
    palette: { skin: "#f2cfae", hair: "#d9b76a", outfit: "#1f7a8c", accent: "#12263a" },
    voice: {
      provider: "elevenlabs",
      voiceId: null,
      stability: 0.75,
      similarityBoost: 0.8,
      styleNotes: "Flat, precise, perfectly timed deadpan; never signals the joke.",
      mock: { baseHz: 185, lilt: 0.2, rate: 5.0 },
    },
    voicePatterns: {
      exclamations: ["Noted.", "This is chaos. I have logged it.", "Unacceptable. Continue."],
      flirts: ["You have been assigned: my attention.", "You are scheduled: one sunset, with me."],
      conflicts: ["Your argument is inefficient. Restart it.", "I have minuted your betrayal."],
      confessionals: [
        "He cooked for six hours. Inefficient. I ate everything. Also inefficient. Interesting.",
        "Feelings arrived today at 14:20, outside the scheduled window. I am investigating.",
      ],
    },
  },
];

/** Episode 1's closing arrival — joins the cast at the end of episode 1. */
export const ARRIVAL_SPAIN: Character = {
  id: "alejandro-spain",
  fullName: "Alejandro Ruiz",
  country: "Spain",
  age: 29,
  gender: "man",
  physicalDescription:
    "Slow-motion hair, smoldering default expression, walks like flamenco is playing somewhere only he can hear.",
  clothingStyle:
    "Crimson shirt tucked loosely into white trousers, sleeves rolled with suspicious perfection.",
  voiceDescription: "Low, velvet, unhurried; makes 'hello' sound like a season finale.",
  accentDirection: "Smooth Spanish accent, deliberate pacing, fully intelligible.",
  personality:
    "Devastatingly confident latecomer who treats the villa like a stage he was born on. Charm first, explanations never.",
  datingStrategy: "Arrive late, say little, dance once, destabilize everyone.",
  strength: "Unshakeable calm — chaos slides off him like water.",
  fatalFlaw: "So committed to mystique that nobody, including him, knows what he actually feels.",
  secret: "He applied to the show four times. The smolder took years of practice in a mirror.",
  romanticPreference:
    "Élodie (France) — 'I came for the one who rates everyone. I will be her ten.'",
  rival: "lucas-brazil",
  initialAttraction: "elodie-france",
  recurringJoke:
    "Everything he does gets invisible flamenco claps ('Why do I hear clapping?' — everyone).",
  signaturePhrase: "The night is young, and so am I. Mostly.",
  imagePrompt:
    `Smoldering confident Spanish man in his late twenties, flowing dark hair, crimson shirt loosely ` +
    `tucked into white trousers, walking a villa entrance walkway at sunset, ${STYLE}`,
  negativeImagePrompt: NEG,
  visualReference:
    "Alejandro: Spanish man, flowing dark hair, crimson shirt, white trousers, smolder, sunset backlight",
  imageSeed: 11009,
  palette: { skin: "#cf9868", hair: "#171310", outfit: "#b3232e", accent: "#f0ead6" },
  voice: {
    provider: "elevenlabs",
    voiceId: null,
    stability: 0.6,
    similarityBoost: 0.8,
    styleNotes: "Low, velvet, unhurried; dramatic pauses he absolutely planned.",
    mock: { baseHz: 105, lilt: 0.5, rate: 4.4 },
  },
  voicePatterns: {
    exclamations: ["Bueno.", "And now... it begins.", "Tranquilo. I am here."],
    flirts: [
      "One dance. I never ask twice. ...Except twice.",
      "You look at me like a difficult question. Good.",
    ],
    conflicts: ["Sunshine boy. We meet.", "I do not argue. I simply win slowly."],
    confessionals: [
      "Four auditions. Four. Tonight, the villa learns why they finally said yes.",
      "The French one looked at me for two seconds. That is practically a wedding.",
    ],
  },
};

export const FULL_CAST: Character[] = [...CAST, ARRIVAL_SPAIN];
