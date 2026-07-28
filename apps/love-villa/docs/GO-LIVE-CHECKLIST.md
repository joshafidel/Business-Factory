# Go-live checklist — the two things only you can do

Everything else is built, deployed, and automated. These items need a human because they
involve logging into _your_ accounts. **The only required item is Part 2 (TikTok), ~20 min
active** (plus a TikTok review wait at the very end that doesn't block anything). Part 1 is
optional and currently deferred.

All file edits below happen in **`apps/love-villa/.env`** — a gitignored file that exists only
on this machine. Never put keys anywhere else, and never commit them.

---

## Part 1 — Rotate the four API keys (~10 min, OPTIONAL — deferred by owner)

**Status: the owner has reviewed this and chosen to skip it for now** (sole access to the
account and keys). Keeping the steps here in case that changes — e.g. before adding
collaborators, or if a provider ever flags unusual usage.

**Why it would matter:** the current keys were pasted into a chat conversation. They were never
committed to git (`.env` is gitignored), but chat history is an exposure surface, so standard
practice is to rotate. Rotation is painless if you do it in this order for each provider:
**create the new key first → paste it into `.env` → then revoke the old key.** That way nothing
is ever broken in between.

### 1. Anthropic (script writing)

1. Open <https://console.anthropic.com/settings/keys>
2. Click **Create Key**, name it `love-villa`, copy the `sk-ant-…` value (it is shown once).
3. In `apps/love-villa/.env`, replace the value of `ANTHROPIC_API_KEY=` with the new key.
4. Back on the keys page, **delete the old key** (the one created before today).

### 2. OpenAI (character & scene art)

1. Open <https://platform.openai.com/api-keys>
2. **Create new secret key** → name it `love-villa` → copy the `sk-…` value.
3. Replace `OPENAI_API_KEY=` in `.env`.
4. **Revoke** the old key on the same page.

### 3. ElevenLabs (voices)

1. Open <https://elevenlabs.io/app/settings/api-keys>
2. **Create API key** → name it `love-villa`. If it asks for permissions, enable at least
   **Text to Speech** (nothing else is required — the pipeline already tolerates a key without
   the "user read" permission).
3. Replace `ELEVENLABS_API_KEY=` in `.env`.
4. **Delete** the old key.

### 4. fal.ai (animation)

1. Open <https://fal.ai/dashboard/keys>
2. **Add key** → name it `love-villa` → copy the value.
3. Replace `FAL_KEY=` in `.env`.
4. **Delete** the old key.

### Verify all four at once (free, changes nothing)

```bash
cd apps/love-villa
npm run setup-show
```

The startup banner lists every provider as **LIVE** or **mock**. All four should read LIVE.
The command then stops itself at the locked `characters` approval gate — it will not modify
anything or spend any money. If a provider shows _mock_, its key line in `.env` has a typo
(most common: a stray space or missing character from the paste).

---

## Part 2 — Connect TikTok (~20 min active, then an optional review wait)

End state: `npm run publish-episode -- --episode 1` uploads the rendered episode straight to
your TikTok account with the generated caption and hashtags.

There are two separate TikTok accounts involved — keep them straight:

- **Developer account** — whoever logs into the developer portal to create the "app"
  (a set of API credentials). Any TikTok login works.
- **Posting account** — the account the episodes are published to. You pick this later, in
  step 2D, by logging into it in the browser. It can be the same account or a different one.

**The single most important thing:** every app page has two tabs at the top — **Production**
and **Sandbox**. The Production tab is a full review application (Terms of Service URL,
Privacy Policy URL, demo video, human review) and its credentials don't work until TikTok
approves it. The **Sandbox** tab works immediately, needs none of that, and is the officially
required way to run before approval. **Do everything below in the Sandbox tab.** Production is
step 2F, later, optional.

### 2A. Create the app shell (~3 min, one time)

If you already created an app, skip to 2B.

1. Go to <https://developers.tiktok.com> → **Log in** (top right) with any TikTok account.
2. Open **Manage apps** (<https://developers.tiktok.com/apps>) → **Connect an app**.
3. In **App details**, fill in only the basics: app name (e.g. `Love Villa Publisher`),
   category (e.g. _Entertainment_), one-line description. Click **Save**.
4. **Ignore** the rest of the Production form — Terms of Service URL, Privacy Policy URL,
   Platforms, the demo-video upload, and the **Submit for review** button are all for step 2F,
   later. Leaving them blank is fine.

### 2B. Set up the Sandbox (~7 min, one time)

1. At the top of your app's page, click the **Sandbox** tab (next to "Production").
2. Create a sandbox if prompted (any name, e.g. `love-villa-test`).
3. In the sandbox, find **Products** → **+ Add products** → add BOTH:
   - **Login Kit** (lets the pipeline connect your posting account), and
   - **Content Posting API** (lets it upload videos).
4. In **Login Kit → Redirect URI**, add exactly:
   ```
   https://business-factory-woad.vercel.app/tiktok/callback
   ```
   This must match `.env` **character for character** — no trailing slash. (This page really
   exists — after you authorize, it shows you the exact command to run next.)
5. In **Scopes** → **+ Add scopes**, enable all three:
   - `user.info.basic`
   - `video.publish`
   - `video.upload`

   ⚠️ The scopes an app starts with (`user.info.profile`, `user.info.stats`, `video.list`) are
   **not** these — they're read-only extras and can stay or go. The three above only become
   addable after the two products from item 3 are added.

6. Find the sandbox's **target users** setting and add the **@username of your posting
   account**. Sandboxes only accept logins from listed target users — skipping this is the #1
   failure mode.
7. Copy the **Client key** and **Client secret** **from the Sandbox tab** — the sandbox has its
   own pair, different from the Production credentials shown on the app details page. The
   Production pair won't work until the app is approved.

### 2C. Put the credentials in `.env` (1 min)

**The pipeline (and its terminal) lives in the Claude session's environment, not on your
machine** — so the easiest path is to give the sandbox credentials to Claude in chat and let it
run every command below for you. Doing it yourself instead means adding these three lines to
`apps/love-villa/.env` (the **Sandbox** pair from step 2B.7):

```env
TIKTOK_CLIENT_KEY=<sandbox client key>
TIKTOK_CLIENT_SECRET=<sandbox client secret>
TIKTOK_REDIRECT_URI=https://business-factory-woad.vercel.app/tiktok/callback
```

### 2D. Connect the posting account (~3 min, one time)

```bash
cd apps/love-villa
npm run tiktok-auth
```

1. The command prints a long `https://www.tiktok.com/v2/auth/authorize…` URL (if Claude runs
   it, it hands you the URL in chat). Open it in a browser.
2. Log into the **posting** account (must be a sandbox target user, step 2B.6) and click
   **Authorize**.
3. The browser lands on our callback page, which shows the follow-up command with a **Copy
   command** button. That command must run where the pipeline lives — paste it (or just the
   code, or the whole callback URL) back into the Claude chat and Claude finishes the
   handshake. Do this within a few minutes — the code expires quickly.
4. Confirm (Claude runs this too):
   ```bash
   npm run tiktok-auth -- --status
   ```
   It should print `Connected as @yourusername` plus the allowed privacy levels.

Tokens are saved to `data/tiktok-tokens.json` (gitignored) and refresh themselves
automatically for ~a year — this step never needs repeating.

### 2E. Test-publish episode 1 (~2 min)

```bash
npm run publish-episode -- --episode 1
```

The episode is already rendered and final-export-approved, so this uploads immediately. The
video appears **on your profile, visible only to you** (private) — that's TikTok policy for
all new apps, not a setting we chose. Watch it in the TikTok app to QA the end-to-end result;
you can manually flip it public from the app (video → ⋯ → Privacy settings) if you like it.

### 2F. Unlock public auto-posting (optional, a few days' wait)

Sandbox/unaudited posts are restricted to private (`SELF_ONLY`) until TikTok approves the app
for **Production**. When you want the pipeline to post publicly with zero manual steps, go back
to the **Production** tab of your app and complete its form:

1. **App icon**: any 1024×1024 image (a Love Villa frame works).
2. **Terms of Service URL**: `https://business-factory-woad.vercel.app/terms`
   **Privacy Policy URL**: `https://business-factory-woad.vercel.app/privacy`
   (Both pages are live — they were added for exactly this.)
3. **Platforms**: check **Web** and give the site URL `https://business-factory-woad.vercel.app`.
4. In Production's **Products/Scopes**, mirror the sandbox: Login Kit + Content Posting API,
   redirect URI, and the `user.info.basic` / `video.publish` / `video.upload` scopes. Remove
   scopes you don't use (extra scopes slow down review).
5. **App review** section: in the explanation box, describe the integration honestly, e.g.
   "Single-operator tool that publishes my own original animated series to my own TikTok
   account via Login Kit (account connection) and Content Posting API (direct post upload).
   No third-party users." Then **Upload** a demo video: a 1–3 min screen recording showing
   the sandbox flow end to end — running `tiktok-auth`, authorizing in the browser, running
   `publish-episode`, and the video appearing on the TikTok profile.
6. Click **Submit for review** (guidelines:
   <https://developers.tiktok.com/doc/content-sharing-guidelines/>). Approval typically takes
   a few days to a couple of weeks.
7. After approval, switch `.env` to the **Production** client key/secret, re-run the 2D
   handshake once against production credentials, and add:
   `TIKTOK_PRIVACY=PUBLIC_TO_EVERYONE`
8. Confirm with `npm run tiktok-auth -- --status` — `PUBLIC_TO_EVERYONE` should now appear in
   the allowed privacy levels.

### If something goes wrong

| Symptom                                           | Cause & fix                                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Authorize page shows `redirect_uri` error         | The URI in the developer portal and in `.env` differ (often a trailing slash). Make them identical, wait ~1 min, retry.            |
| Authorize page shows `scope` error                | One of the three scopes isn't enabled on the app (or sandbox). Enable it, retry.                                                   |
| `--code` exchange fails with "invalid code/grant" | Codes expire after a few minutes and are single-use. Re-run `npm run tiktok-auth` for a fresh URL and paste the new code promptly. |
| Authorize page shows `client_key` error           | The app isn't approved yet and you're using its production credentials. Use the **Sandbox** credentials instead (see 2B.7).        |
| `--status` doesn't list `PUBLIC_TO_EVERYONE`      | Expected before the audit (2F). Posts still work — they're just private.                                                           |
| Sandbox login says the account isn't allowed      | The posting account's @username isn't added as a sandbox **target user**. Add it in the sandbox settings.                          |

---

## What you do NOT need to do

- Vercel, the database, the dashboard, rendering, validation, budgets — all live and automated.
- Episode 1 is rendered, validated, approved, and watchable on the dashboard already.
- Once Parts 1–2 are done, a full episode cycle is just:
  `generate-episode → approve script → produce-episode → approve rough-cut → render-episode → approve final-export → publish-episode`.
