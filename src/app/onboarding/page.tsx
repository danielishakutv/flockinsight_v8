"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { organization, signOut } from "@/lib/auth-client";
import { slugify, randomSuffix } from "@/lib/slug";
import { Wordmark } from "@/components/brand";
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

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const churchName = String(form.get("churchName")).trim();

    setLoading(true);
    try {
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
        toast.error(created.error?.message || "Could not create your church.");
        return;
      }
      await organization.setActive({ organizationId: created.data.id });
      toast.success("Church created!");
      router.push("/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-8">
        <Wordmark logoClassName="size-10" className="text-2xl" />
      </div>
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Set up your church</CardTitle>
          <CardDescription>
            One more step — name your church to get started.
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
                autoFocus
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={loading}
            >
              {loading && <Loader2 className="animate-spin" />}
              Create church
            </Button>
          </form>
          <button
            onClick={() => signOut().then(() => router.push("/login"))}
            className="text-muted-foreground mt-6 w-full text-center text-sm hover:underline"
          >
            Sign out
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
