"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { signUp, organization } from "@/lib/auth-client";
import { slugify, randomSuffix } from "@/lib/slug";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const churchName = String(form.get("churchName")).trim();
    const name = String(form.get("name")).trim();
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));

    setLoading(true);
    try {
      // 1) Create the user account
      const { error: signUpError } = await signUp.email({
        email,
        password,
        name,
      });
      if (signUpError) {
        toast.error(signUpError.message || "Could not create your account.");
        return;
      }

      // 2) Create the church (organization). Retry once if the slug is taken.
      const base = slugify(churchName) || "church";
      let created = await organization.create({
        name: churchName,
        slug: base,
      });
      if (created.error) {
        created = await organization.create({
          name: churchName,
          slug: `${base}-${randomSuffix()}`,
        });
      }
      if (created.error || !created.data) {
        toast.error(
          created.error?.message || "Account made, but church setup failed.",
        );
        router.push("/onboarding");
        return;
      }

      // 3) Make it the active church
      await organization.setActive({ organizationId: created.data.id });

      toast.success(`Welcome to FlockInsight, ${name.split(" ")[0]}!`);
      router.push("/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Create your church account</CardTitle>
        <CardDescription>
          Free 30-day trial · No credit card required
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="churchName">Church name</Label>
            <Input
              id="churchName"
              name="churchName"
              placeholder="Grace Chapel"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              placeholder="Pastor John Adeyemi"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@church.org"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              minLength={8}
              required
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            Create free account
          </Button>
          <p className="text-muted-foreground text-center text-xs">
            By creating an account you agree to our{" "}
            <Link href="/terms" className="hover:text-primary underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="hover:text-primary underline">
              Privacy Policy
            </Link>
            .
          </p>
        </form>

        <p className="text-muted-foreground mt-6 text-center text-sm">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-primary font-semibold hover:underline"
          >
            Log in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
