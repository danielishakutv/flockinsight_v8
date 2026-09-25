import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_VERSION } from "@/lib/version";

/**
 * About this software.
 *
 * The one place inside the app that says who built it and on what terms. It
 * lives in Settings because that is where an administrator goes looking for
 * it, and nowhere else because everything past the sign-in page belongs to the
 * church.
 *
 * The terms matter more than the credit: the source and the design are ours,
 * the licence is theirs, and the data is theirs alone. Saying so plainly, in
 * the product, is worth more than a line in a contract nobody reopens.
 */
export function AboutSoftware({ churchName }: { churchName?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">About this software</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          <span className="text-foreground font-semibold">FlockInsight</span> is
          a church management platform — attendance, members, groups, giving,
          finance, follow-up, training, meetings and the reporting that ties
          them together. Built for churches in Nigeria and across Africa, and
          built to work on a phone, on a weak connection.
        </p>

        <div>
          <p className="font-semibold">Who built it</p>
          <p className="text-muted-foreground mt-0.5">
            Developed by Toko Technologies, a division of Toko Academy Ltd.
            Made in Nigeria.
          </p>
        </div>

        <div>
          <p className="font-semibold">The terms</p>
          <ul className="text-muted-foreground mt-1 list-disc space-y-1 pl-5">
            <li>
              The source code and design of this platform remain the
              intellectual property of Toko Technologies.
            </li>
            <li>
              {churchName ?? "Your church"} holds a licence to use it — the
              software is licensed, not sold.
            </li>
            <li>
              <span className="text-foreground font-medium">
                The data belongs to the church and to nobody else.
              </span>{" "}
              Your members, giving, finances and records are yours. You can
              export all of it at any time from Reports, and we will never sell
              it, share it or use it for anything but running this service for
              you.
            </li>
          </ul>
        </div>

        <p className="text-muted-foreground border-t pt-3 text-xs">
          Version {APP_VERSION} · © {new Date().getFullYear()} Toko
          Technologies
        </p>
      </CardContent>
    </Card>
  );
}
