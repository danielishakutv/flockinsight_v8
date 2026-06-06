"use client";

import { use, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { organization, useSession } from "@/lib/auth-client";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function accept() {
    startTransition(async () => {
      const { data, error } = await organization.acceptInvitation({
        invitationId: id,
      });
      if (error) {
        toast.error(error.message || "Could not accept invitation.");
        return;
      }
      const orgId = data?.invitation?.organizationId;
      if (orgId) await organization.setActive({ organizationId: orgId });
      setDone(true);
      toast.success("You've joined the church!");
      router.push("/dashboard");
      router.refresh();
    });
  }

  const backHref = `/login?redirect=${encodeURIComponent(`/accept-invitation/${id}`)}`;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-8">
        <Wordmark logoClassName="size-10" className="text-2xl" />
      </div>
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Church invitation</CardTitle>
          <CardDescription>
            You&apos;ve been invited to join a church on FlockInsight.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <div className="flex justify-center py-4">
              <Loader2 className="text-muted-foreground animate-spin" />
            </div>
          ) : session?.user ? (
            <Button
              size="lg"
              className="w-full"
              onClick={accept}
              disabled={pending || done}
            >
              {pending && <Loader2 className="animate-spin" />}
              Accept invitation
            </Button>
          ) : (
            <div className="space-y-3 text-center">
              <p className="text-muted-foreground text-sm">
                Please log in or create an account with the invited email
                address to accept.
              </p>
              <div className="flex gap-2">
                <Button asChild size="lg" className="flex-1">
                  <Link href={backHref}>Log in</Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="flex-1">
                  <Link href="/signup">Sign up</Link>
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
