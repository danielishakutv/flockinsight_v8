"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function SignOutButton({
  variant = "outline",
}: {
  variant?: "outline" | "ghost" | "default";
}) {
  const router = useRouter();
  return (
    <Button
      variant={variant}
      onClick={async () => {
        await signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      <LogOut className="size-4" />
      Sign out
    </Button>
  );
}
