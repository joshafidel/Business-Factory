# Supplying the APIs — complete setup guide

Every provider is optional and independent: add keys one at a time and the pipeline upgrades that
layer only. All keys go in `apps/love-villa/.env` (copy from `.env.example`; the file is
gitignored — **never commit keys**). After editing `.env`, run any command — the startup banner
shows exactly which providers are LIVE vs mock.

Recommended order: **1. Anthropic → 2. ElevenLabs → 3. OpenAI images → 4. TikTok → 5. fal.ai.**

---

## 1. Anthropic Claude — episode writing

What it unlocks: real scripts, season arcs, and cast refinement instead of the fixture writers'
room. This is the biggest jump in comedy/writing quality per dollar.

1. Create an account at the Claude Console: <https://console.anthropic.com>
2. Add billing: <https://console.anthropic.com/settings/billing>
3. Create an API key: <https://console.anthropic.com/settings/keys> → **Create Key** → copy the
   `sk-ant-…` value (shown once).
4. In `.env`:
   ```env
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-opus-5     # default; the strongest writer for serialized comedy
   ```
5. Verify: `npm run generate-episode -- --episode 6` — the banner should read
   `LLM (Anthropic): LIVE (claude-opus-5)` and the ledger will log the expected cost before the call.

Pricing (<https://claude.com/pricing#api>): claude-opus-5 is $5/M input, $25/M output tokens —
an episode script is roughly $0.10–0.30. Model docs: <https://platform.claude.com/docs/en/about-claude/models/overview>

## 2. ElevenLabs — character voices

What it unlocks: real, distinct, **stable** voices per character (the single biggest jump in
perceived production value).

1. Create an account: <https://elevenlabs.io> → pick a plan (Creator or higher recommended;
   pricing: <https://elevenlabs.io/pricing>).
2. Get your API key: <https://elevenlabs.io/app/settings/api-keys> → **Create API key**.
3. Pick one voice per character in the Voice Library: <https://elevenlabs.io/app/voice-library>.
   Match each character's `voiceDescription`/`accentDirection` in `data/characters/CAST.md`
   (e.g. a warm melodic Italian-accented male voice for Matteo). Add each voice to **My Voices**,
   then copy its **Voice ID** (voice page → ID button).
4. Map the IDs — copy `data/voice-map.example.json` to `data/voice-map.json` and fill in:
   ```json
   { "brock-usa": "pNInz6obpgDQGcFmaJgB", "poppy-uk": "…", "matteo-italy": "…", … }
   ```
   These IDs are **locked identities** — never change them between episodes.
5. In `.env`:
   ```env
   ELEVENLABS_API_KEY=...
   ELEVENLABS_MODEL=eleven_multilingual_v2   # best for accented English
   ```
6. Verify: `npm run produce-episode -- --episode N` — banner shows `Voices (ElevenLabs): LIVE`.
   Any unmapped character falls back to mock voice with a loud warning.

Docs: <https://elevenlabs.io/docs/api-reference/text-to-speech/convert>. Cost ballpark ~$0.15
per 1k characters; an episode (~1,200 spoken characters) ≈ $0.15–0.40.

## 3. OpenAI — character & scene art (gpt-image-1)

What it unlocks: real illustrated character cutouts (transparent PNG) and villa backgrounds in
the show's locked glossy style, replacing the parametric SVG placeholders.

1. Create an account: <https://platform.openai.com>
2. Add billing: <https://platform.openai.com/settings/organization/billing/overview>
3. Create an API key: <https://platform.openai.com/api-keys> → **Create new secret key**.
   Note: gpt-image-1 may require organization verification
   (<https://platform.openai.com/settings/organization/general> → Verify).
4. In `.env`:
   ```env
   OPENAI_API_KEY=sk-...
   IMAGE_QUALITY=high      # use high for the publishable pass; draft while iterating
   ```
5. Regenerate the reference art once (this refreshes cast + villa images):
   ```bash
   npm run setup-show -- --force
   ```
   With `REUSE_EXISTING_ASSETS=true` (default) every later episode reuses this art — you pay for
   the cast/villa once, not per episode.

Docs: <https://platform.openai.com/docs/guides/image-generation> · pricing:
<https://platform.openai.com/docs/pricing> (portrait 1024×1536: low ≈ $0.016, medium ≈ $0.063/img).

## 4. TikTok — automatic posting (Content Posting API)

What it unlocks: `npm run publish-episode -- --episode N` posts the rendered episode directly to
your TikTok account with the generated caption + hashtags.

### 4.1 Create the developer app

1. Go to the TikTok developer portal: <https://developers.tiktok.com> and log in (any TikTok
   login works — this is the _developer_ account; the _posting_ account is chosen later during
   OAuth).
2. **Manage apps** → **Connect an app**: <https://developers.tiktok.com/apps>. Fill in the app
   basics (name, icon, category).
3. In the app configuration, **Add products** → add **Login Kit** and **Content Posting API**.
   Docs: <https://developers.tiktok.com/doc/content-posting-api-get-started/>
4. Under **Login Kit → Redirect URI**, register your redirect URI. It must be HTTPS. Easiest:
   use your dashboard domain, e.g.
   `https://business-factory-woad.vercel.app/tiktok/callback`
   (the page doesn't need to exist — you'll copy the code from the address bar).
5. Under **Scopes**, enable `user.info.basic`, `video.publish`, and `video.upload`.
6. Copy the **Client key** and **Client secret** from the app page.

### 4.2 Configure the pipeline

```env
TIKTOK_CLIENT_KEY=aw...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=https://business-factory-woad.vercel.app/tiktok/callback
```

### 4.3 Connect the posting account (one-time, ~2 minutes)

```bash
npm run tiktok-auth                    # prints the authorization URL
# open it, log into the TikTok account that should post, approve
# you land on ...callback?code=XXXX&scopes=... — copy the code value
npm run tiktok-auth -- --code XXXX     # exchanges + saves tokens (gitignored)
npm run tiktok-auth -- --status        # sanity check: shows @username + allowed privacy levels
```

Tokens live in `data/tiktok-tokens.json`; access tokens auto-refresh (TikTok rotates refresh
tokens — the pipeline persists the newest automatically; refresh tokens last ~365 days).

### 4.4 The audit rule (important)

**Unaudited TikTok apps can only post PRIVATE (SELF_ONLY) videos.** This is TikTok policy for
every new app, not a pipeline limitation: until your app passes TikTok's audit, the API hides
`PUBLIC_TO_EVERYONE` from the allowed privacy levels and shows an "in testing" notice on posts.
Workflow:

- **Now:** publish with the default `SELF_ONLY` — the video appears on your account visible only
  to you; review it in the app and manually flip it public from your profile if you wish, or use
  it to QA the automation end-to-end.
- **For real automation:** request the audit from your app page (guidelines:
  <https://developers.tiktok.com/doc/content-sharing-guidelines/>). Approval typically takes a
  few days–weeks; afterwards run `npm run publish-episode -- --episode N --privacy PUBLIC_TO_EVERYONE`
  or set `TIKTOK_PRIVACY=PUBLIC_TO_EVERYONE` in `.env`.

### 4.5 Publish

```bash
npm run render-episode -- --episode 1            # must exist + pass the final-export gate
npm run approve -- --stage final-export --episode 1
npm run publish-episode -- --episode 1           # uploads + posts; receipt in data/episodes/…/publish.json
```

Publishing is gated behind the `final-export` approval on purpose — it's the only irreversible
step in the pipeline.

## 5. fal.ai — true animation (image-to-video)

See **docs/ANIMATION-QUALITY.md** for the full quality strategy. Short version:

1. Create an account: <https://fal.ai> → API key: <https://fal.ai/dashboard/keys>
2. In `.env`:
   ```env
   FAL_KEY=...
   FAL_I2V_MODEL=fal-ai/kling-video/v2.1/standard/image-to-video
   MAX_VIDEO_GENS_PER_EPISODE=8
   ```
3. `npm run produce-episode -- --episode N` now renders a clean still of each scene, animates it
   (characters blink, breathe, gesture; hair/cloth move; cinematic camera), and the final render
   plays real animation instead of camera moves. Failed clips fall back to camera moves
   automatically. Model catalog + per-clip pricing: <https://fal.ai/models?categories=image-to-video>

## Budget guard

`MAX_COST_PER_EPISODE_USD` (default $5) is enforced across **all** providers: every live call
logs its expected cost *before* the request into `data/episodes/*/cost-ledger.json` and the
pipeline refuses calls that would cross the budget. Fully-live episode with animation:
≈ $2.50–4.50. Without animation: ≈ $0.50–1.50.
