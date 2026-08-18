"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function SignOutButton({
  variant = "outline",
  size,
}: {
  variant?: "outline" | "ghost" | "default";
  size?: "sm" | "default" | "lg";
}) {
  const router = useRouter();
  return (
    <Button
      variant={variant}
      size={size}
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
