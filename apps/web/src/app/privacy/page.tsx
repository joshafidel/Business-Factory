export const metadata = { title: "Privacy Policy" };

/**
 * Minimal privacy page. Exists primarily because third-party developer
 * platforms (e.g. TikTok's app review) require a public Privacy Policy URL.
 * The site collects no visitor data; the only third-party data handled is the
 * operator's own social accounts via OAuth.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-zinc-800">
      <h1 className="text-2xl font-semibold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-zinc-500">Business Factory · Last updated July 2026</p>
      <div className="mt-8 space-y-4 text-sm leading-6">
        <p>
          Business Factory is a private, single-operator content-production tool. It has no public
          user accounts, no sign-up, no analytics trackers, and no advertising. Visitors to this
          site are not profiled and no personal information is collected from them.
        </p>
        <p>
          <strong>Social platform connections.</strong> When the operator connects a social media
          account (e.g. TikTok) via OAuth, the platform provides access tokens and basic profile
          information (username, display name). These are stored privately, used solely to publish
          the operator&apos;s own content to the operator&apos;s own account, and are never shared
          with anyone. Access can be revoked at any time from the social platform&apos;s app
          settings, which invalidates the stored tokens.
        </p>
        <p>
          <strong>No third-party data.</strong> The platform does not collect, store, or process
          data about any person other than the operator.
        </p>
        <p>
          Questions or deletion requests:{" "}
          <a className="text-violet-600 underline" href="mailto:joshafidel@gmail.com">
            joshafidel@gmail.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
