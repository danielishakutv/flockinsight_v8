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
import { Toaster } from "@/components/ui/sonner";
import { useT } from "@/components/i18n-provider";
import { ORG_TYPES, cleanOrgType, type OrgType } from "@/lib/org-type";
import { setNewOrganizationType } from "./actions";

export default function OnboardingPage() {
  const t = useT();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [orgType, setOrgType] = useState<OrgType>("church");

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
        toast.error(created.error?.message || "Could not create your organisation.");
        return;
      }
      await organization.setActive({ organizationId: created.data.id });
      if (orgType !== "church") {
        try {
          await setNewOrganizationType(orgType);
        } catch (e) {
          // Created and active either way; the type can be set in Settings.
          console.error("[onboarding] could not record the organisation type", e);
        }
      }
      toast.success(t("auth.accountReady"));
      router.push("/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-10">
        <div className="mb-8">
          <Wordmark logoClassName="size-10" className="text-2xl" />
        </div>
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">{t("auth.createYourAccount")}</CardTitle>
            <CardDescription>
              One more step — tell us what you run to get started.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="orgType">{t("orgType.question")}</Label>
                <select
                  id="orgType"
                  value={orgType}
                  onChange={(e) => setOrgType(cleanOrgType(e.target.value))}
                  className="border-input bg-background focus-visible:ring-ring/50 h-11 w-full rounded-lg border px-3 text-base focus-visible:ring-[3px] focus-visible:outline-none sm:h-10 md:text-sm"
                >
                  {ORG_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`orgType.${type}.label`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="churchName">{t(`orgType.${orgType}.name`)}</Label>
                <Input
                  id="churchName"
                  name="churchName"
                  placeholder={t(`orgType.${orgType}.placeholder`)}
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
                Continue
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
      <Toaster />
    </>
  );
}
