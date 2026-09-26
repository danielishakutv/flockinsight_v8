import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { MakerFooter } from "@/components/maker-footer";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/components/i18n-provider";
import { getI18n } from "@/lib/i18n/server";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale, dict } = await getI18n();
  return (
    <I18nProvider locale={locale} dict={dict}>
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
      <MakerFooter />
      <Toaster />
    </div>
    </I18nProvider>
  );
}
