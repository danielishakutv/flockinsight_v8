import Link from "next/link";
import { Wordmark } from "@/components/brand";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* soft brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,theme(colors.primary/12%),transparent)]"
      />
      <Link href="/" className="mb-8">
        <Wordmark logoClassName="size-10" className="text-2xl" />
      </Link>
      <div className="w-full max-w-md">{children}</div>
      <p className="text-muted-foreground mt-8 text-center text-xs">
        © {new Date().getFullYear()} Toko Technologies · FlockInsight
      </p>
    </div>
  );
}
