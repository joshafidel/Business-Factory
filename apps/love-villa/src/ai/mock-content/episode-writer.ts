import {
  type Character,
  type ContinuityUpdate,
  type DialogueLine,
  type EpisodeBeat,
  type EpisodeScript,
  type Scene,
  type SeasonState,
} from "../schemas";
import { mulberry32 } from "../../utils/wav";

/**
 * Mock "writers' room": expands a season-arc beat into a full episode script
 * without an LLM. Episode 1 is fully hand-authored (the showcase); later
 * episodes are composed from the beat's hand-tuned key lines plus each
 * character's voice-pattern library, deterministically seeded per episode.
 */

const COUNTRY_TAG: Record<string, string> = {
  "brock-usa": "🇺🇸",
  "poppy-uk": "🇬🇧",
  "matteo-italy": "🇮🇹",
  "elodie-france": "🇫🇷",
  "lucas-brazil": "🇧🇷",
  "sienna-australia": "🇦🇺",
  "rohan-india": "🇮🇳",
  "greta-germany": "🇩🇪",
  "alejandro-spain": "🇪🇸",
};

function line(
  speaker: string,
  text: string,
  emphasize: string[] = [],
  delivery = "",
): DialogueLine {
  return { speaker, text, delivery, emphasize };
}

// ── Episode 1: fully authored ───────────────────────────────────────────────

const N = "narrator";

const EPISODE_1: EpisodeScript = {
  episode: 1,
  title: "Two Kings, One Croissant",
  logline:
    "Brock and Matteo discover they want the same woman; Élodie rates the entire war a five — until Spain walks in.",
  scenes: [
    {
      index: 0,
      slot: "hook",
      kind: "scene",
      locationId: "pool",
      characters: ["brock-usa", "matteo-italy"],
      visual:
        "Brock and Matteo frozen nose to nose at the pool edge, horrified realization on both faces, smoothie and risotto pan between them",
      lines: [
        line(N, "This is Brock. In ten seconds he declares war on Italy.", ["war"]),
        line(N, "Over a woman who rated him a five.", ["five"]),
      ],
      motion: "push-in",
      sfx: ["heartbeat"],
      textMessages: [],
    },
    {
      index: 1,
      slot: "setup",
      kind: "scene",
      locationId: "pool",
      characters: ["elodie-france", "brock-usa"],
      visual:
        "Élodie lounging in sunglasses, supremely unbothered, while Brock kneels presenting a mango smoothie like a crown jewel",
      lines: [
        line(N, "This is Élodie. France. She rates everything.", ["everything"]),
        line(N, "The sunset? Four. This villa? Five. Feelings? Zero.", ["Zero"]),
        line("elodie-france", "A smoothie. At ten a.m. ...Five.", ["Five"], "bored verdict"),
      ],
      motion: "pan-right",
      sfx: [],
      textMessages: [],
    },
    {
      index: 2,
      slot: "setup",
      kind: "scene",
      locationId: "kitchen",
      characters: ["matteo-italy", "elodie-france"],
      visual:
        "Matteo presents a steaming risotto with operatic pride while Élodie examines one grain of rice like a jeweler",
      lines: [
        line(N, "Enter Matteo. Italy. He cooked her his grandmother's risotto.", ["risotto"]),
        line("elodie-france", "Also five.", ["five"], "flat"),
        line(N, "Two men. One five. This ends badly.", ["badly"]),
      ],
      motion: "pan-left",
      sfx: ["pop"],
      textMessages: [],
    },
    {
      index: 3,
      slot: "escalation",
      kind: "argument",
      locationId: "kitchen",
      characters: ["brock-usa", "matteo-italy"],
      visual:
        "Split-screen kitchen standoff: Brock cradling his blender like a newborn, Matteo brandishing a wooden spoon like a rapier",
      lines: [
        line("brock-usa", "Bro. We're both all-in on the same girl?!", ["same", "girl"]),
        line("matteo-italy", "You made her a smoothie. I made her a promise.", ["promise"]),
        line(N, "Gentlemen. She rated you EQUALLY.", ["EQUALLY"]),
      ],
      motion: "parallax",
      sfx: ["whoosh"],
      textMessages: [],
    },
    {
      index: 4,
      slot: "escalation",
      kind: "confessional",
      locationId: "confessional",
      characters: ["poppy-uk"],
      visual: "Poppy in the neon Spill Room armchair, tea in hand, having the best day of her life",
      lines: [
        line("poppy-uk", "My money's on the blender. It has a plan.", ["blender"], "deadpan"),
        line(N, "Poppy is enjoying this WAY too much.", ["WAY"]),
      ],
      motion: "push-in",
      sfx: [],
      textMessages: [],
    },
    {
      index: 5,
      slot: "escalation",
      kind: "scene",
      locationId: "firepit",
      characters: ["sienna-australia", "greta-germany"],
      visual:
        "Sienna vibrating with delight at the firepit while Greta writes on her clipboard with military precision",
      lines: [
        line(N, "The villa reacts with grace and maturity.", ["grace"]),
        line("sienna-australia", "Best. Day. EVER.", ["EVER"], "gleeful"),
        line("greta-germany", "War declared. Fourteen hundred hours. Logged.", ["Logged"]),
      ],
      motion: "pan-left",
      sfx: ["pop"],
      textMessages: [],
    },
    {
      index: 6,
      slot: "escalation",
      kind: "confessional",
      locationId: "confessional",
      characters: ["elodie-france"],
      visual:
        "Élodie in the Spill Room, examining her nails, betraying the faintest possible smile",
      lines: [
        line(
          "elodie-france",
          "The smoothie? Five. The risotto? Five. The drama? ...Seven.",
          ["Seven"],
          "reluctantly delighted",
        ),
        line(N, "A SEVEN. Unprecedented.", ["SEVEN"]),
      ],
      motion: "push-in",
      sfx: [],
      textMessages: [],
    },
    {
      index: 7,
      slot: "twist",
      kind: "arrival",
      locationId: "walkway",
      characters: ["alejandro-spain", "brock-usa"],
      visual:
        "Torch-lit walkway at night: Alejandro strides in slow motion, crimson shirt glowing, while Brock's soul leaves his body",
      lines: [
        line(N, "And then. The doors. SPAIN.", ["SPAIN"]),
        line(
          "alejandro-spain",
          "I heard someone here rates men out of ten. I am the ten.",
          ["ten"],
          "velvet calm",
        ),
        line("brock-usa", "...Who invited SPAIN?!", ["SPAIN"], "betrayed"),
      ],
      motion: "shake",
      sfx: ["sting"],
      textMessages: [],
    },
    {
      index: 8,
      slot: "engagement",
      kind: "endcard",
      locationId: "firepit",
      characters: [],
      visual: "End card: Who should Élodie pick? 🇺🇸 🇮🇹 🇪🇸 Vote in the comments!",
      lines: [line(N, "America. Italy. Spain. Vote. Now.", ["Vote"])],
      motion: "zoom-out",
      sfx: ["ding"],
      textMessages: [],
    },
  ],
  caption:
    "America and Italy declared war over France… and then SPAIN walked in 💀 Who should Élodie pick? " +
    "Episode 1 of Love Villa: Nations 🌍❤️",
  hashtags: [
    "#LoveVillaNations",
    "#realitytv",
    "#datingshow",
    "#comedy",
    "#animation",
    "#loveTriangle",
    "#episode1",
    "#fyp",
  ],
  musicDirection:
    "Upbeat tropical-pop bed; heartbeat under the hook; dramatic sting on the arrival.",
  continuityNotes: [
    "Brock and Matteo rivalry over Élodie is now open",
    "Élodie's rating system established (everything is a five; drama is a seven)",
    "Alejandro arrived for Élodie — villa destabilized",
    "The narrator is a recurring device from episode 1 onward",
  ],
};

// ── Procedural writer for episodes 2+ ───────────────────────────────────────

type PatternKind = "exclamations" | "flirts" | "conflicts" | "confessionals";

class LinePool {
  private used = new Set<string>();
  constructor(
    private cast: Map<string, Character>,
    private rand: () => number,
  ) {}

  pick(characterId: string, kind: PatternKind): DialogueLine {
    const c = this.cast.get(characterId);
    if (!c) return line(characterId, "..." /* validated later */);
    const options = c.voicePatterns[kind].filter((t) => !this.used.has(t));
    const list = options.length > 0 ? options : c.voicePatterns[kind];
    const text = list[Math.floor(this.rand() * list.length)] ?? list[0] ?? "...";
    this.used.add(text);
    const caps = text
      .split(/\s+/)
      .filter((w) => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w));
    return line(
      characterId,
      text,
      caps.map((w) => w.replace(/[^A-Za-z']/g, "")),
    );
  }
}

const DAY_LOCATIONS = ["pool", "kitchen", "terrace", "firepit", "bedroom"];

function twistScene(beat: EpisodeBeat): Pick<Scene, "kind" | "locationId"> {
  if (beat.keyEvents.some((e) => /arriv/i.test(e)))
    return { kind: "arrival", locationId: "walkway" };
  if (beat.episode === 6) return { kind: "text-message", locationId: "bedroom" };
  return { kind: "scene", locationId: "firepit" };
}

export function writeEpisodeScriptMock(
  beat: EpisodeBeat,
  cast: Character[],
  state: SeasonState,
): EpisodeScript {
  if (beat.episode === 1) return EPISODE_1;

  const rand = mulberry32(beat.episode * 7919);
  const active = cast.filter((c) => !state.eliminated.includes(c.id));
  const castMap = new Map(active.map((c) => [c.id, c]));
  const pool = new LinePool(castMap, rand);
  const focus = beat.focusCharacters.filter((id) => castMap.has(id));
  const [f0, f1, f2] = [
    focus[0] ?? "poppy-uk",
    focus[1] ?? "greta-germany",
    focus[2] ?? focus[0] ?? "poppy-uk",
  ];
  const others = active.map((c) => c.id).filter((id) => !focus.includes(id));
  const commentator = others[Math.floor(rand() * others.length)] ?? "poppy-uk";

  const keyLines = beat.keyLines.filter((k) => castMap.has(k.speaker));
  const hookKey = keyLines[0];
  const twistKey = keyLines[keyLines.length - 1];
  const midKeys = keyLines.slice(1, -1);

  const locA = DAY_LOCATIONS[beat.episode % DAY_LOCATIONS.length] ?? "pool";
  const locB = DAY_LOCATIONS[(beat.episode + 2) % DAY_LOCATIONS.length] ?? "terrace";
  const twist = twistScene(beat);

  const toLine = (k: { speaker: string; text: string }): DialogueLine => {
    const caps = k.text
      .split(/\s+/)
      .filter((w) => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w))
      .map((w) => w.replace(/[^A-Za-z']/g, ""));
    return line(k.speaker, k.text, caps);
  };

  const scenes: Scene[] = [
    {
      index: 0,
      slot: "hook",
      kind: "scene",
      locationId: locA,
      characters: [
        ...new Set([hookKey?.speaker, f0, f1].filter((x): x is string => Boolean(x))),
      ].slice(0, 3),
      visual: `${beat.hook} — caught mid-moment: ${beat.summary.slice(0, 110)}`,
      lines: [line(N, beat.hook), hookKey ? toLine(hookKey) : pool.pick(f0, "exclamations")],
      motion: "push-in",
      sfx: ["heartbeat"],
      textMessages: [],
    },
    {
      index: 1,
      slot: "setup",
      kind: "scene",
      locationId: locA,
      characters: [f0, f1, f2],
      visual: `Setup: ${beat.keyEvents[0] ?? beat.summary.slice(0, 100)}`,
      lines: [
        midKeys[0] ? toLine(midKeys[0]) : pool.pick(f2, "flirts"),
        pool.pick(f1, "conflicts"),
        pool.pick(f0, "flirts"),
      ],
      motion: "pan-right",
      sfx: [],
      textMessages: [],
    },
    {
      index: 2,
      slot: "escalation",
      kind: "argument",
      locationId: locB,
      characters: [f0, f1],
      visual: `Argument erupts: ${beat.keyEvents[1] ?? "tempers flare"}`,
      lines: [
        pool.pick(f0, "conflicts"),
        pool.pick(f1, "conflicts"),
        midKeys[1] ? toLine(midKeys[1]) : pool.pick(f0, "exclamations"),
      ],
      motion: "parallax",
      sfx: ["whoosh"],
      textMessages: [],
    },
    {
      index: 3,
      slot: "escalation",
      kind: "confessional",
      locationId: "confessional",
      characters: [f2],
      visual: `${f2} in the Spill Room, processing the chaos`,
      lines: [pool.pick(f2, "confessionals")],
      motion: "push-in",
      sfx: [],
      textMessages: [],
    },
    {
      index: 4,
      slot: "escalation",
      kind: "scene",
      locationId: "firepit",
      characters: [commentator, f1],
      visual: `Villa reaction: ${beat.keyEvents[2] ?? "everyone watches, delighted"}`,
      lines: [pool.pick(commentator, "exclamations"), pool.pick(f1, "flirts")],
      motion: "pan-left",
      sfx: ["pop"],
      textMessages: [],
    },
    {
      index: 5,
      slot: "escalation",
      kind: "confessional",
      locationId: "confessional",
      characters: [f0],
      visual: `${f0} in the Spill Room, pretending to be fine`,
      lines: [pool.pick(f0, "confessionals")],
      motion: "push-in",
      sfx: [],
      textMessages: [],
    },
    {
      index: 6,
      slot: "twist",
      kind: twist.kind,
      locationId: twist.locationId,
      characters: [twistKey?.speaker ?? f1, f0],
      visual: `TWIST: ${beat.twist}`,
      lines: [
        line(N, "And then it happens.", ["then"]),
        twistKey ? toLine(twistKey) : pool.pick(f1, "exclamations"),
        pool.pick(f0, "exclamations"),
      ],
      motion: "shake",
      sfx: ["sting"],
      textMessages:
        twist.kind === "text-message"
          ? [
              { from: "The Villa", text: beat.twist.slice(0, 80) },
              { from: "Everyone", text: "WHAT?!" },
            ]
          : [],
    },
    {
      index: 7,
      slot: "engagement",
      kind: "endcard",
      locationId: "firepit",
      characters: [],
      visual: `End card: ${beat.engagement.text}`,
      lines: [
        line(
          N,
          beat.engagement.text
            .replace(/[^\x20-\x7Eà-ÿÀ-Ÿ'’]/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 90),
        ),
      ],
      motion: "zoom-out",
      sfx: ["ding"],
      textMessages: [],
    },
  ];

  const flags = beat.focusCharacters.map((id) => COUNTRY_TAG[id] ?? "").join("");
  return {
    episode: beat.episode,
    title: beat.title,
    logline: beat.summary.split(". ").slice(0, 1).join(". ") + ".",
    scenes,
    caption: `${beat.hook} ${flags} ${beat.engagement.text} — Love Villa: Nations, episode ${beat.episode} 🌍❤️`,
    hashtags: [
      "#LoveVillaNations",
      "#realitytv",
      "#datingshow",
      "#comedy",
      "#animation",
      `#episode${beat.episode}`,
      "#fyp",
      "#drama",
    ],
    musicDirection:
      "Upbeat tropical-pop bed; heartbeat under the hook; dramatic sting on the twist.",
    continuityNotes: [...beat.unresolvedThreads, beat.connectionToPrevious],
  };
}

// ── Continuity update derived from a beat ───────────────────────────────────

export function continuityUpdateFromBeat(beat: EpisodeBeat): ContinuityUpdate {
  const arrivals = beat.episode === 1 ? ["alejandro-spain"] : [];
  const newCouples = beat.episode === 10 ? [{ a: "lucas-brazil", b: "poppy-uk" }] : [];
  const secretsRevealed =
    beat.episode === 5
      ? ["brock-usa: the seven-figure startup is a $43 lemonade stand"]
      : beat.episode === 7
        ? ["lucas-brazil: cannot swim (told Poppy privately)"]
        : beat.episode === 8
          ? ["poppy-uk: secret romantic poetry notebook (read aloud)"]
          : beat.episode === 9
            ? ["alejandro-spain: four-year villa strategy notebook"]
            : [];
  return {
    episode: beat.episode,
    summary: beat.summary,
    newCouples,
    brokenCouples: [],
    attractionChanges: [],
    newRivalries:
      beat.episode === 1
        ? [
            { a: "brock-usa", b: "matteo-italy", reason: "Both pursuing Élodie" },
            { a: "lucas-brazil", b: "alejandro-spain", reason: "Villa sunshine-king contest" },
          ]
        : [],
    newAlliances: [],
    secretsRevealed,
    arrivals,
    eliminations: [],
    unresolvedStorylines: beat.unresolvedThreads,
    continuityNotes: [beat.connectionToPrevious],
  };
}
