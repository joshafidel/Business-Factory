import { chromium } from "@playwright/test";
for (const opts of [
  { name: "explicit-proxy", proxy: { server: process.env.HTTPS_PROXY } },
  { name: "no-proxy", proxy: undefined },
]) {
  try {
    const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", proxy: opts.proxy });
    const p = await b.newPage({ ignoreHTTPSErrors: true });
    const res = await p.goto("https://example.com", { timeout: 15000 });
    console.log(opts.name, "->", res?.status());
    await b.close();
  } catch (err) {
    console.log(opts.name, "FAILED:", String(err).split("\n")[0]);
  }
}
