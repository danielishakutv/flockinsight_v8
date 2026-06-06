"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, Settings, Moon, Sun, Laptop, Shield } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { signOut } from "@/lib/auth-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function UserMenu({
  name,
  email,
  className,
  isSuperAdmin = false,
}: {
  name: string;
  email: string;
  className?: string;
  isSuperAdmin?: boolean;
}) {
  const router = useRouter();
  const { setTheme } = useTheme();

  async function handleSignOut() {
    await signOut();
    toast.success("Signed out");
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`flex items-center gap-3 rounded-xl p-1.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-ring focus-visible:ring-2 ${className ?? ""}`}
      >
        <Avatar className="size-9">
          <AvatarFallback className="bg-primary/15 text-primary font-bold">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 max-sm:hidden">
          <p className="truncate text-sm font-semibold leading-tight">{name}</p>
          <p className="text-muted-foreground truncate text-xs">{email}</p>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate">{name}</span>
          <span className="text-muted-foreground truncate text-xs font-normal">
            {email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings />
            Settings
          </Link>
        </DropdownMenuItem>
        {isSuperAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/superadmin">
              <Shield />
              Platform Admin
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Laptop /> System
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
