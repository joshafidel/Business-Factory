import { type SeasonArc } from "../schemas";

/**
 * Season 1 arc: ten connected episodes. Each beat carries hand-tuned hook,
 * twist, engagement, and signature key lines; the script generator (mock mode)
 * or Claude (live mode) expands beats into full scenes while preserving these.
 */
export const SEASON_ARC: SeasonArc = {
  season: 1,
  theme: "Eight nations, one villa, and the world's least diplomatic summit on love.",
  arcSummary:
    "A love triangle over Élodie detonates on day one and is immediately complicated by Spanish latecomer " +
    "Alejandro. Across ten episodes: Brock's bravado cracks and Poppy accidentally defends him; Rohan's " +
    "over-planning collides with Sienna's chaos; Greta schedules her way into Matteo's kitchen and heart; " +
    "Lucas's pool secret and Poppy's poetry notebook both surface; Alejandro's strategy is exposed; and the " +
    "finale locks in couples while planting season 2.",
  episodes: [
    {
      episode: 1,
      title: "Two Kings, One Croissant",
      hook: "America and Italy just declared war over France.",
      summary:
        "Brock and Matteo simultaneously discover they are both pursuing Élodie. Smoothie diplomacy and an " +
        "eight-course revenge risotto escalate into the villa's first international incident, while Élodie " +
        "rates both suitors a five. A torch-lit twist ends day one: Spain has entered the villa — for Élodie.",
      focusCharacters: ["brock-usa", "matteo-italy", "elodie-france", "poppy-uk", "greta-germany"],
      keyEvents: [
        "Brock and Matteo discover their shared crush on Élodie",
        "Élodie rates both men a five out of ten",
        "Greta logs the conflict; Poppy provides commentary",
        "Alejandro (Spain) arrives on the walkway, announcing he came for 'the French one'",
      ],
      twist: "New arrival: Alejandro from Spain walks in and says he's here for Élodie.",
      engagement: { kind: "vote", text: "Who should Élodie pick? 🇺🇸🇮🇹🇪🇸 Vote in the comments!" },
      keyLines: [
        { speaker: "brock-usa", text: "Bro. We're both all-in on the same girl?!" },
        { speaker: "matteo-italy", text: "You made her a smoothie. I made her a promise." },
        {
          speaker: "elodie-france",
          text: "The smoothie? Five. The risotto? Five. The drama? ...Seven.",
        },
        {
          speaker: "alejandro-spain",
          text: "I heard someone here rates men out of ten. I am the ten.",
        },
      ],
      unresolvedThreads: [
        "Who will Élodie actually rate above a five?",
        "Matteo vs Brock rivalry is now open",
        "Alejandro's real intentions unknown",
      ],
      connectionToPrevious:
        "Series premiere — plants the triangle, the rivalry, and Alejandro's arrival.",
    },
    {
      episode: 2,
      title: "The Spanish Inquisition of Hearts",
      hook: "The new guy just asked Élodie to dance — in front of BOTH of them.",
      summary:
        "Alejandro's first morning: he says eleven words total and destabilizes the entire villa. Brock " +
        "responds with a louder blender; Matteo cooks a threatening breakfast. Élodie gives Alejandro a six " +
        "— the highest score ever recorded — and the villa loses its mind.",
      focusCharacters: [
        "alejandro-spain",
        "elodie-france",
        "brock-usa",
        "matteo-italy",
        "lucas-brazil",
      ],
      keyEvents: [
        "Alejandro's dance with Élodie at the firepit",
        "Élodie awards a historic six out of ten",
        "Brock's confidence shows its first crack in the Spill Room",
        "Lucas clocks Alejandro as competition for villa sunshine-king",
      ],
      twist:
        "Élodie rates Alejandro a six — a villa record — then immediately regrets revealing it.",
      engagement: { kind: "question", text: "Is Alejandro genuine or just smooth? 👀" },
      keyLines: [
        { speaker: "alejandro-spain", text: "Dance with me. The song will find us." },
        { speaker: "elodie-france", text: "Six. ...I said that out loud. Non. NON." },
        { speaker: "brock-usa", text: "A SIX? I've been grinding for a five-point-five all week!" },
      ],
      unresolvedThreads: ["Brock's confidence wobble", "Lucas vs Alejandro cold war begins"],
      connectionToPrevious: "Direct continuation of Alejandro's episode 1 arrival.",
    },
    {
      episode: 3,
      title: "Heartquake",
      hook: "One quiz question just ended two friendships and started a romance.",
      summary:
        "First villa challenge: 'Heartquake' — couples answer questions about each other while standing on a " +
        "wobble platform over the pool. Rohan's spreadsheet fails him; Sienna dares him into the best answer " +
        "of the day. Greta and Matteo accidentally win everything, to their mutual horror and delight.",
      focusCharacters: [
        "rohan-india",
        "sienna-australia",
        "greta-germany",
        "matteo-italy",
        "brock-usa",
      ],
      keyEvents: [
        "Original challenge: Heartquake wobble-platform quiz",
        "Rohan freezes; Sienna dares him to answer with feelings instead of data",
        "Greta and Matteo win the challenge as a chaos pairing",
        "Brock falls in the pool defending his 'perfect balance'",
      ],
      twist:
        "Challenge result: the algorithm loses, the chaos couple wins — Greta chooses Matteo for the prize dinner.",
      engagement: {
        kind: "cliffhanger",
        text: "Greta + Matteo dinner date... what could go wrong? 🍝📋",
      },
      keyLines: [
        { speaker: "sienna-australia", text: "Drop the spreadsheet and SAY it, Kapoor!" },
        { speaker: "rohan-india", text: "Fine! She's... category five. And I'm not evacuating." },
        {
          speaker: "greta-germany",
          text: "We won. This was not scheduled. I am thrilled. Confusing.",
        },
      ],
      unresolvedThreads: ["Rohan-Sienna almost-moment", "Greta-Matteo prize dinner pending"],
      connectionToPrevious: "Sienna's ep2 teasing of Rohan escalates into the challenge dare.",
    },
    {
      episode: 4,
      title: "Dinner at Eight, Feelings at Nine",
      hook: "Greta scheduled a 90-minute date. Matteo cooked for six hours. Nobody's ready.",
      summary:
        "The prize dinner: Greta arrives with an agenda; Matteo arrives with eight courses and unresolved " +
        "Élodie feelings. Across the villa, Élodie stress-tests Alejandro's mystique and finds one crack: " +
        "he laughed — really laughed — at her rating system. Both pairs end closer than they planned.",
      focusCharacters: ["greta-germany", "matteo-italy", "elodie-france", "alejandro-spain"],
      keyEvents: [
        "Greta and Matteo's chaotic-perfect prize dinner",
        "Matteo eats cheese to impress Greta; suffers heroically and confesses nothing",
        "Élodie interrogates Alejandro; his mask slips into a genuine laugh",
        "Poppy watches everything and files it away",
      ],
      twist: "Matteo realizes mid-tiramisu that he didn't think about Élodie once all night.",
      engagement: {
        kind: "vote",
        text: "Greta+Matteo or Élodie+Alejandro — which date won the night? 🗳️",
      },
      keyLines: [
        { speaker: "greta-germany", text: "Item four: eye contact. Beginning now." },
        { speaker: "matteo-italy", text: "You minuted our dinner?... Read it to me slowly." },
        { speaker: "elodie-france", text: "He laughed like a person. Alarming. Six point five." },
      ],
      unresolvedThreads: ["Matteo's pivot from Élodie to Greta", "Matteo's dairy secret ticking"],
      connectionToPrevious:
        "The ep3 challenge prize plays out; Élodie continues testing Alejandro from ep2.",
    },
    {
      episode: 5,
      title: "The Lemonade Papers",
      hook: "Brock's 'seven-figure empire' just got fact-checked at the firepit.",
      summary:
        "Rohan's innocent networking question unravels Brock's startup story in front of everyone. The villa " +
        "braces to laugh — and Poppy, of all people, torches the pile-on instead. Brock's honest firepit " +
        "speech about being broke and hopeful becomes his most genuinely liked moment ever.",
      focusCharacters: ["brock-usa", "poppy-uk", "rohan-india", "lucas-brazil"],
      keyEvents: [
        "Brock's lemonade-stand LLC secret is revealed",
        "Poppy unexpectedly defends Brock mid-roast",
        "Brock's honest speech lands; villa respect unlocked",
        "Poppy panics about having publicly displayed sincerity",
      ],
      twist:
        "Secret revealed: the empire is a lemonade stand — and Poppy is the one who saves him.",
      engagement: { kind: "question", text: "Poppy defending Brock?? What is HAPPENING 👀" },
      keyLines: [
        { speaker: "rohan-india", text: "Your projections list revenue as 'vibes'." },
        {
          speaker: "brock-usa",
          text: "Okay. Real talk? It's lemonade. It's forty-three dollars. It's mine.",
        },
        {
          speaker: "poppy-uk",
          text: "Leave him. At least his dream fits in a cup. Yours needs a slideshow.",
        },
      ],
      unresolvedThreads: [
        "Poppy's accidental sincerity",
        "Is Brock-Poppy a thing?? (they insist: no)",
      ],
      connectionToPrevious:
        "Brock's ep2 confidence crack finally splits open; Rohan's rivalry with flair over data.",
    },
    {
      episode: 6,
      title: "The Vote of No Confidence",
      hook: "The villa voted. Someone's suitcase is already on the walkway.",
      summary:
        "First elimination vote — viewers chose the 'least matched' contestant. The suitcase on the walkway " +
        "belongs to... nobody: it's a twist. The vote result is sealed in an envelope that will only open " +
        "when a couple officially forms. The villa turns on itself guessing whose name is inside.",
      focusCharacters: ["poppy-uk", "lucas-brazil", "alejandro-spain", "sienna-australia"],
      keyEvents: [
        "Elimination fake-out: the suitcase is empty",
        "Sealed envelope introduced: opens when the first official couple forms",
        "Paranoia montage; alliances form overnight",
        "Lucas and Poppy accidentally hold hands during the announcement — both deny it",
      ],
      twist: "No one leaves — instead a sealed vote result now hangs over every future couple.",
      engagement: {
        kind: "cliffhanger",
        text: "WHOSE name is in the envelope? Wrong answers only 😈",
      },
      keyLines: [
        {
          speaker: "sienna-australia",
          text: "An empty suitcase? That's the scariest thing I've ever seen.",
        },
        { speaker: "poppy-uk", text: "We held hands for SAFETY. It's a safety hand." },
        {
          speaker: "lucas-brazil",
          text: "In Brazil we say: the hand knows before the heart. ...My hand knows.",
        },
      ],
      unresolvedThreads: ["Sealed envelope looming", "Lucas-Poppy safety hand incident"],
      connectionToPrevious: "The ep1 vote engagement pays off; alliances seeded in ep5 solidify.",
    },
    {
      episode: 7,
      title: "Deep End Diplomacy",
      hook: "Lucas just refused a pool party. LUCAS.",
      summary:
        "Villa pool olympics. Lucas — sunshine incarnate — dodges every water event until Alejandro smells " +
        "weakness and calls a cannonball contest. Poppy spots the truth, fakes a cramp, and quietly gets the " +
        "party moved to the shallow end. Lucas confesses his secret to her at the firepit; she doesn't joke. Not once.",
      focusCharacters: ["lucas-brazil", "poppy-uk", "alejandro-spain", "brock-usa"],
      keyEvents: [
        "Pool olympics; Lucas's swimming secret nearly exposed",
        "Alejandro weaponizes the cannonball contest",
        "Poppy covers for Lucas without being asked",
        "Firepit confession: Lucas tells Poppy he can't swim; she stays sincere",
      ],
      twist:
        "Lucas tells Poppy his secret — and Poppy responds with sincerity, her rarest resource.",
      engagement: { kind: "question", text: "Poppy was NICE. On purpose. Ship or panic? 🚢" },
      keyLines: [
        { speaker: "alejandro-spain", text: "Cannonball contest. Sunshine boy goes first." },
        {
          speaker: "lucas-brazil",
          text: "The ocean and me... we are friends who respect distance.",
        },
        { speaker: "poppy-uk", text: "I'm not being nice. I'm being... efficient. Shut up." },
      ],
      unresolvedThreads: ["Lucas-Poppy now genuinely close", "Alejandro's edge revealed publicly"],
      connectionToPrevious:
        "The ep6 safety-hand becomes real trust; Alejandro-Lucas cold war from ep2 heats up.",
    },
    {
      episode: 8,
      title: "The Notebook Situation",
      hook: "Someone found Poppy's poetry. And read it. OUT LOUD.",
      summary:
        "Bedroom chaos: Sienna, hunting for sunscreen, finds Poppy's poetry notebook and — not knowing whose " +
        "it is — performs a dramatic reading at breakfast. The poem is unmistakably about a boy who dances. " +
        "Poppy claims it's 'satire'. Lucas quietly memorizes every word. Sienna realizes what she's done and, " +
        "for the first time ever, apologizes without a dare attached.",
      focusCharacters: ["poppy-uk", "sienna-australia", "lucas-brazil", "greta-germany"],
      keyEvents: [
        "Poppy's poetry notebook discovered and read aloud",
        "The dancing-boy poem is obviously about Lucas",
        "Poppy's 'satire' defense convinces no one",
        "Sienna's first sincere apology; Greta logs it as a historic event",
      ],
      twist: "Secret revealed: Poppy's poetry — and everyone now knows who it's about.",
      engagement: {
        kind: "cliffhanger",
        text: "Lucas learned the poem BY HEART. What's he going to do with it?? 📖",
      },
      keyLines: [
        {
          speaker: "sienna-australia",
          text: "'His feet speak the language my heart is scared of' — WHO WROTE THIS?!",
        },
        { speaker: "poppy-uk", text: "It's satire. It's a satirical poem. About a satirical boy." },
        {
          speaker: "greta-germany",
          text: "14:32 — Sienna apologized. No dare attached. Logging historic event.",
        },
      ],
      unresolvedThreads: ["Lucas holds the poem", "Poppy fully exposed emotionally"],
      connectionToPrevious:
        "Pays off Poppy's ep1-established notebook secret and ep7 firepit closeness.",
    },
    {
      episode: 9,
      title: "The Ten Out of Ten Conspiracy",
      hook: "Alejandro has a list. Élodie's name is at the top. It's not a love list.",
      summary:
        "Greta, reorganizing the kitchen at 06:00, finds Alejandro's audition notebook: four years of notes " +
        "on how to win villa shows — charm arcs, target selection, 'the French one: highest value'. The villa " +
        "splits: is it calculated, or is it four years of wanting to be loved with a spreadsheet? Élodie reads " +
        "the notebook alone at the firepit... and finds the last page: her name, and next to it, no strategy. " +
        "Just 'actually funny. actually kind. off-script.'",
      focusCharacters: [
        "alejandro-spain",
        "elodie-france",
        "greta-germany",
        "matteo-italy",
        "brock-usa",
      ],
      keyEvents: [
        "Alejandro's strategy notebook discovered",
        "Villa tribunal at the firepit; Brock surprisingly defends him ('we've all got a pitch deck, man')",
        "Élodie reads the final page: his notes on her stopped being strategy",
        "Élodie burns the notebook and tells no one what the last page said",
      ],
      twist:
        "Betrayal inverted: the 'strategy list' ends with Alejandro genuinely off-script about Élodie.",
      engagement: { kind: "vote", text: "Can Élodie trust him now? YES or RUN 🏃‍♀️" },
      keyLines: [
        {
          speaker: "greta-germany",
          text: "I found a four-year plan. It is beautiful. It is also a crime scene.",
        },
        {
          speaker: "alejandro-spain",
          text: "Four auditions. You practice a face long enough, you forget you have one.",
        },
        { speaker: "elodie-france", text: "The last page... c'est un... peut-être." },
      ],
      unresolvedThreads: [
        "Élodie's secret about the last page",
        "Villa trust in Alejandro fractured",
      ],
      connectionToPrevious: "Alejandro's ep2 mystique and ep7 edge finally get an origin story.",
    },
    {
      episode: 10,
      title: "The Envelope, Please",
      hook: "First official couple. Which opens the envelope. From episode six. Tonight.",
      summary:
        "Finale night. Lucas answers the poem — with a dance, obviously, then with words. Poppy says yes in " +
        "plain English, no joke, a villa first. That makes them the first official couple — which unseals the " +
        "ep6 envelope. The vote inside named the 'least matched' contestant: Alejandro. He stands to leave; " +
        "Élodie stands up too — 'the vote was before the last page.' Season ends on Greta's clipboard: " +
        "'Season 2 agenda, item one: everything is unresolved.'",
      focusCharacters: [
        "lucas-brazil",
        "poppy-uk",
        "alejandro-spain",
        "elodie-france",
        "greta-germany",
      ],
      keyEvents: [
        "Lucas responds to the poem; Poppy answers sincerely — first official couple",
        "The ep6 envelope unseals: Alejandro was voted least matched",
        "Élodie publicly stakes her maybe on Alejandro",
        "Season 2 hook: a boat with new flags appears on the horizon",
      ],
      twist:
        "The envelope names Alejandro — and Élodie chooses him anyway, sort of, maybe, a seven.",
      engagement: {
        kind: "preview",
        text: "Season 2: new flags on the horizon. Which countries should board? 🌍",
      },
      keyLines: [
        {
          speaker: "lucas-brazil",
          text: "This dance is called: I Read Your Poem Two Hundred Times.",
        },
        {
          speaker: "poppy-uk",
          text: "Yes. No joke attached. Don't make it weird. ...Okay make it a bit weird.",
        },
        { speaker: "elodie-france", text: "He is a seven. Final answer. For now." },
      ],
      unresolvedThreads: ["Alejandro-Élodie unresolved 'seven'", "Season 2 arrivals teased"],
      connectionToPrevious: "Resolves ep6 envelope, ep8 poem, ep9 notebook; launches season 2.",
    },
  ],
};
