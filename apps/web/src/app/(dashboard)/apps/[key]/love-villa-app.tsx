import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { MediaActions } from "@/components/media-actions";

/**
 * Love Villa: Nations app page. The production pipeline is the standalone
 * Remotion app in apps/love-villa (episodes render locally to 1080x1920 MP4s
 * and are uploaded to TikTok by hand in the MVP), so this page is the show's
 * control-room view: concept, cast, season status, and the exact commands.
 */

const CAST = [
  {
    flag: "🇺🇸",
    name: "Brock Calloway Jr.",
    country: "United States",
    bio: "Startup gym-bro hype-man. Pitches romance like a Series A.",
  },
  {
    flag: "🇬🇧",
    name: "Poppy Whitcombe",
    country: "United Kingdom",
    bio: "Deadpan commentator. Rates every kiss out of ten. Secret poet.",
  },
  {
    flag: "🇮🇹",
    name: "Matteo Fiorelli",
    country: "Italy",
    bio: "Operatic romantic chef. Seduces via risotto, suffers via dairy.",
  },
  {
    flag: "🇫🇷",
    name: "Élodie Marchand",
    country: "France",
    bio: "Everything is a five out of ten. The drama? ...A seven.",
  },
  {
    flag: "🇧🇷",
    name: "Lucas Ferreira",
    country: "Brazil",
    bio: "Human sunshine, dances instead of walking. Cannot actually swim.",
  },
  {
    flag: "🇦🇺",
    name: "Sienna Blake",
    country: "Australia",
    bio: "Chaos gremlin. Converts feelings into dares before they land.",
  },
  {
    flag: "🇮🇳",
    name: "Rohan Kapoor",
    country: "India",
    bio: "Romantic strategist with an 'algorithm' (it's astrology).",
  },
  {
    flag: "🇩🇪",
    name: "Greta Müller",
    country: "Germany",
    bio: "Schedules spontaneity. Flirtation window: 19:00–19:30 sharp.",
  },
  {
    flag: "🇪🇸",
    name: "Alejandro Ruiz",
    country: "Spain",
    bio: "Episode-1 twist arrival. Practiced the smolder for four years.",
  },
];

/**
 * Episodes with committed web previews (apps/web/public/love-villa/…).
 * render-episode drops preview.mp4 + poster there automatically; add the
 * episode number here once the files are committed.
 */
const WATCHABLE: number[] = [];

const EPISODES = [
  { n: 1, title: "Two Kings, One Croissant", status: "rendered" },
  { n: 2, title: "The Spanish Inquisition of Hearts", status: "scripted" },
  { n: 3, title: "Heartquake", status: "scripted" },
  { n: 4, title: "Dinner at Eight, Feelings at Nine", status: "scripted" },
  { n: 5, title: "The Lemonade Papers", status: "scripted" },
  { n: 6, title: "The Vote of No Confidence", status: "planned" },
  { n: 7, title: "Deep End Diplomacy", status: "planned" },
  { n: 8, title: "The Notebook Situation", status: "planned" },
  { n: 9, title: "The Ten Out of Ten Conspiracy", status: "planned" },
  { n: 10, title: "The Envelope, Please", status: "planned" },
];

const PIPELINE_STEPS = [
  ["npm run setup-show", "Show bible, villa, cast + reference art, season state"],
  ["npm run generate-season -- --episodes 10", "Connected 10-episode arc"],
  ["npm run generate-episode -- --episode 1", "Script, shot list, caption, continuity update"],
  ["npm run produce-episode -- --episode 1", "Images, voices, music, animation + rough cut"],
  ["npm run render-episode -- --episode 1", "Final 1080×1920 MP4 + thumbnail + upload package"],
  ["npm run validate-episode -- --episode 1", "Continuity, safety, subtitle & duration QA"],
  ["npm run publish-episode -- --episode 1", "Auto-post to the connected TikTok account"],
];

export function LoveVillaApp({ description }: { description: string }) {
  return (
    <>
      <PageHeader title="🌹 Love Villa: Nations" description={description}>
        <StatusBadge status="ACTIVE" />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {WATCHABLE.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Watch</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {WATCHABLE.map((n) => {
                  const id = `episode-${String(n).padStart(3, "0")}`;
                  const ep = EPISODES.find((e) => e.n === n);
                  return (
                    <figure key={n} className="space-y-2">
                      <video
                        controls
                        playsInline
                        preload="metadata"
                        poster={`/love-villa/${id}-poster.png`}
                        src={`/love-villa/${id}.mp4`}
                        className="aspect-[9/16] w-full rounded-xl border border-border bg-black object-contain"
                      />
                      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          EP {n} — {ep?.title ?? id}
                        </span>
                        <MediaActions
                          variant="links"
                          src={`/love-villa/${id}.mp4`}
                          filename={`love-villa-${id}.mp4`}
                        />
                      </figcaption>
                    </figure>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Season 1 — episode tracker</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {EPISODES.map((ep) => (
                <div
                  key={ep.n}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <p className="min-w-0 truncate text-sm font-medium">
                    <span className="mr-2 text-muted-foreground">EP {ep.n}</span>
                    {ep.title}
                  </p>
                  <Badge
                    variant={
                      ep.status === "rendered"
                        ? "success"
                        : ep.status === "scripted"
                          ? "warning"
                          : "default"
                    }
                  >
                    {ep.status}
                  </Badge>
                </div>
              ))}
              <p className="pt-1 text-xs text-muted-foreground">
                Episodes are produced by the pipeline in{" "}
                <code className="rounded bg-muted px-1">apps/love-villa</code> and posted to TikTok
                automatically via <code className="rounded bg-muted px-1">publish-episode</code>{" "}
                once the account is connected (
                <code className="rounded bg-muted px-1">tiktok-auth</code>).
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>The cast</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {CAST.map((c) => (
                <div key={c.name} className="rounded-lg border border-border bg-card p-3">
                  <p className="text-sm font-semibold">
                    <span className="mr-1.5">{c.flag}</span>
                    {c.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{c.country}</p>
                  <p className="mt-1.5 text-xs text-muted-foreground">{c.bio}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Production pipeline (local)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              {PIPELINE_STEPS.map(([cmd, what], i) => (
                <div key={cmd}>
                  <p className="font-mono text-xs text-primary">
                    {i + 1}. {cmd}
                  </p>
                  <p className="text-xs text-muted-foreground">{what}</p>
                </div>
              ))}
              <p className="pt-1 text-xs text-muted-foreground">
                Six human approval gates (cast, season, script, visual prompts, rough cut, final
                export) sit between generation and export. Everything runs in free mock mode without
                API keys; add Anthropic / OpenAI / ElevenLabs keys for real writing, art, and
                voices.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How it works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm text-muted-foreground">
              <p>1. Claude writes serialized episodes with full season memory.</p>
              <p>2. Consistent characters: locked palettes, seeds, and voice configs.</p>
              <p>3. Remotion animates scenes, subtitles, and camera moves into a vertical MP4.</p>
              <p>
                4. Every episode ships with caption, hashtags, thumbnail, and a production report.
              </p>
              <p>5. You review at six checkpoints — nothing publishes itself.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
