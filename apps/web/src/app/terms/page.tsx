export const metadata = { title: "Terms of Service" };

/**
 * Minimal terms page. Exists primarily because third-party developer platforms
 * (e.g. TikTok's app review) require a public Terms of Service URL for the
 * site. This is a single-operator content-production tool, not a consumer
 * service.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-zinc-800">
      <h1 className="text-2xl font-semibold">Terms of Service</h1>
      <p className="mt-2 text-sm text-zinc-500">Business Factory · Last updated July 2026</p>
      <div className="mt-8 space-y-4 text-sm leading-6">
        <p>
          Business Factory is a private, single-operator platform used to produce and publish the
          operator&apos;s own original media content (including the animated series &ldquo;Love
          Villa: Nations&rdquo;) to social platforms such as TikTok.
        </p>
        <p>
          The service is not offered to the public. No accounts are available to third parties, no
          user-generated content is accepted, and no goods or services are sold through this site.
        </p>
        <p>
          All content produced by the platform is original work owned by the operator. Publishing to
          third-party platforms is performed via their official APIs, on the operator&apos;s own
          accounts, subject to those platforms&apos; terms.
        </p>
        <p>
          The software is provided as-is, without warranty of any kind. Questions:{" "}
          <a className="text-violet-600 underline" href="mailto:joshafidel@gmail.com">
            joshafidel@gmail.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
