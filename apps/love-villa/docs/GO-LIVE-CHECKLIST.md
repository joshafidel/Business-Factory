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
  step 2C, by logging into it in the browser. It can be the same account or a different one.

### 2A. Create the developer app (~10 min, one time)

1. Go to <https://developers.tiktok.com> → **Log in** (top right) with any TikTok account.
2. Open **Manage apps** (<https://developers.tiktok.com/apps>) → **Connect an app**.
3. Fill in the basics: app name (e.g. `Love Villa Publisher`), an icon (any square image),
   category (e.g. _Entertainment_), and a one-line description.
4. In the app's configuration page, find **Add products** and add BOTH:
   - **Login Kit** (lets the pipeline connect your posting account), and
   - **Content Posting API** (lets it upload videos).
5. In **Login Kit → Redirect URI**, add exactly:
   ```
   https://business-factory-woad.vercel.app/tiktok/callback
   ```
   This must match `.env` **character for character** — no trailing slash. (The page itself
   doesn't need to exist; you'll copy a code from the browser's address bar.)
6. In **Scopes**, enable all three: `user.info.basic`, `video.publish`, `video.upload`.
7. Copy the **Client key** and **Client secret** shown on the app page.

> **If TikTok says the app must be reviewed before use:** every new app also gets a free
> **Sandbox** that works immediately. On the app page, create a sandbox, enable the same two
> products + three scopes + redirect URI in it, add your posting account's @username as a
> **target user**, and use the sandbox's client key/secret in step 2B. Sandbox behaves
> identically for our purposes (posts are private-only, same as any unaudited app — see 2E).

### 2B. Put the credentials in `.env` (1 min)

Add/replace these three lines in `apps/love-villa/.env`:

```env
TIKTOK_CLIENT_KEY=<client key from step 2A.7>
TIKTOK_CLIENT_SECRET=<client secret from step 2A.7>
TIKTOK_REDIRECT_URI=https://business-factory-woad.vercel.app/tiktok/callback
```

### 2C. Connect the posting account (~3 min, one time)

```bash
cd apps/love-villa
npm run tiktok-auth
```

1. The command prints a long `https://www.tiktok.com/v2/auth/authorize…` URL. Open it in a
   browser.
2. Log into the **posting** account and click **Authorize**.
3. The browser lands on
   `https://business-factory-woad.vercel.app/tiktok/callback?code=XXXX&scopes=…` — the page
   content doesn't matter; look at the **address bar**. Copy everything between `code=` and
   the first `&` (it's long — that's normal; paste it as-is, no need to decode anything).
4. Finish the handshake and confirm:
   ```bash
   npm run tiktok-auth -- --code <paste-the-code-here>
   npm run tiktok-auth -- --status
   ```
   `--status` should print `Connected as @yourusername` plus the allowed privacy levels.

Tokens are saved to `data/tiktok-tokens.json` (gitignored) and refresh themselves
automatically for ~a year — this step never needs repeating.

### 2D. Test-publish episode 1 (~2 min)

```bash
npm run publish-episode -- --episode 1
```

The episode is already rendered and final-export-approved, so this uploads immediately. The
video appears **on your profile, visible only to you** (private) — that's TikTok policy for
all new apps, not a setting we chose. Watch it in the TikTok app to QA the end-to-end result;
you can manually flip it public from the app (video → ⋯ → Privacy settings) if you like it.

### 2E. Unlock public auto-posting (optional, a few days' wait)

New TikTok apps are restricted to private (`SELF_ONLY`) posts until TikTok audits them. When
you want the pipeline to post publicly with zero manual steps:

1. On your app page at <https://developers.tiktok.com/apps>, submit the app for review
   (guidelines: <https://developers.tiktok.com/doc/content-sharing-guidelines/>). Approval
   typically takes a few days to a couple of weeks.
2. After approval, add to `.env`: `TIKTOK_PRIVACY=PUBLIC_TO_EVERYONE`
3. Confirm with `npm run tiktok-auth -- --status` — `PUBLIC_TO_EVERYONE` should now appear in
   the allowed privacy levels.

### If something goes wrong

| Symptom                                           | Cause & fix                                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Authorize page shows `redirect_uri` error         | The URI in the developer portal and in `.env` differ (often a trailing slash). Make them identical, wait ~1 min, retry.            |
| Authorize page shows `scope` error                | One of the three scopes isn't enabled on the app (or sandbox). Enable it, retry.                                                   |
| `--code` exchange fails with "invalid code/grant" | Codes expire after a few minutes and are single-use. Re-run `npm run tiktok-auth` for a fresh URL and paste the new code promptly. |
| Authorize page shows `client_key` error           | The app isn't approved yet and you're using its production credentials. Use the **Sandbox** credentials instead (see 2A note).     |
| `--status` doesn't list `PUBLIC_TO_EVERYONE`      | Expected before the audit (2E). Posts still work — they're just private.                                                           |
| Sandbox login says the account isn't allowed      | The posting account's @username isn't added as a sandbox **target user**. Add it in the sandbox settings.                          |

---

## What you do NOT need to do

- Vercel, the database, the dashboard, rendering, validation, budgets — all live and automated.
- Episode 1 is rendered, validated, approved, and watchable on the dashboard already.
- Once Parts 1–2 are done, a full episode cycle is just:
  `generate-episode → approve script → produce-episode → approve rough-cut → render-episode → approve final-export → publish-episode`.
