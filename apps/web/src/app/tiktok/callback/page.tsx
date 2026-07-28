import { CopyButton } from "./copy-button";

export const metadata = { title: "TikTok connected" };

/**
 * OAuth landing page for the Love Villa TikTok connection (the registered
 * redirect URI). TikTok sends the user here with ?code=...; we surface the
 * exact next command so nothing has to be fished out of the address bar.
 */
export default async function TikTokCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string; error_description?: string }>;
}) {
  const params = await searchParams;
  const code = params.code ?? "";
  const command = `npm run tiktok-auth -- --code ${code}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-4 text-zinc-100">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 p-8">
        {params.error ? (
          <>
            <h1 className="text-xl font-semibold text-red-400">TikTok authorization failed</h1>
            <p className="mt-2 text-sm text-zinc-400">
              TikTok returned <code className="text-red-300">{params.error}</code>
              {params.error_description ? `: ${params.error_description}` : "."} Close this tab, fix
              the app configuration in the TikTok developer portal, and run{" "}
              <code className="text-zinc-200">npm run tiktok-auth</code> again for a fresh link.
            </p>
          </>
        ) : code ? (
          <>
            <h1 className="text-xl font-semibold text-emerald-400">
              ✓ TikTok authorized — one step left
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              Run this in your terminal (from <code className="text-zinc-200">apps/love-villa</code>
              ) within the next few minutes — the code expires quickly:
            </p>
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-4">
              <code className="min-w-0 flex-1 break-all font-mono text-sm text-zinc-100">
                {command}
              </code>
              <CopyButton text={command} label="Copy command" />
            </div>
            <p className="mt-4 text-xs text-zinc-500">
              When it prints “Connected as @yourusername”, the account is linked permanently —
              tokens refresh themselves from then on.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">TikTok connection</h1>
            <p className="mt-2 text-sm text-zinc-400">
              This page is the OAuth landing spot for the Love Villa publishing pipeline. Nothing to
              see here directly — start from your terminal with{" "}
              <code className="text-zinc-200">npm run tiktok-auth</code>, which prints the
              authorization link that ends up back on this page.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
