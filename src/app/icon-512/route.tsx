import { appIcon } from "@/lib/pwa-icon";

export const dynamic = "force-static";

export function GET() {
  return appIcon(512);
}
