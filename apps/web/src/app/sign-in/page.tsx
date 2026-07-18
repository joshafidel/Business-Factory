import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/auth";
import { Button, Card, CardContent, Input, Label } from "@/components/ui";

export const metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");
  const params = await searchParams;

  async function doSignIn(formData: FormData): Promise<void> {
    "use server";
    const callbackUrl = (formData.get("callbackUrl") as string) || "/";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: callbackUrl,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect(`/sign-in?error=invalid&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      }
      throw err;
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6">
          <h1 className="text-lg font-semibold">AI Business Factory</h1>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">Sign in to your workspace</p>
          {params.error ? (
            <p className="mb-4 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
              Invalid email or password.
            </p>
          ) : null}
          <form action={doSignIn} className="space-y-4">
            <input type="hidden" name="callbackUrl" value={params.callbackUrl ?? "/"} />
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            Local dev: run <code className="rounded bg-muted px-1">pnpm db:seed</code> then use{" "}
            <code className="rounded bg-muted px-1">owner@factory.local</code> /{" "}
            <code className="rounded bg-muted px-1">factory-dev-password</code>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
