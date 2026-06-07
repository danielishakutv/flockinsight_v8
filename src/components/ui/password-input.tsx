"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * Password field with a show/hide toggle. Drop-in replacement for
 * `<Input type="password" />` — forwards all the usual input props
 * (name, id, autoComplete, minLength, required, …). Each instance
 * manages its own visibility state.
 */
function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const [show, setShow] = React.useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={show ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg outline-none focus-visible:ring-[3px]"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export { PasswordInput };
