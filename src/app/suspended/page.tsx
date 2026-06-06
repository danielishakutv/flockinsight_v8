import { ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/session";
import { Wordmark } from "@/components/brand";
import { Card, CardContent } from "@/components/ui/card";
import { SignOutButton } from "@/components/app/sign-out-button";

export const metadata = { title: "Account suspended" };

export default async function SuspendedPage() {
  await requireUser();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-8">
        <Wordmark logoClassName="size-10" className="text-2xl" />
      </div>
      <Card className="w-full max-w-md text-center shadow-lg">
        <CardContent className="flex flex-col items-center gap-4 py-10">
          <div className="bg-destructive/10 text-destructive grid size-16 place-items-center rounded-2xl">
            <ShieldAlert className="size-8" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Account suspended</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              This church account has been suspended. Please contact the
              FlockInsight team to restore access.
            </p>
          </div>
          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}
