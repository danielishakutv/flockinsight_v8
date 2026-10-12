import { scriptSafeJson } from "@/lib/script-json";

/**
 * Renders a JSON-LD structured-data <script> for rich results on Google.
 * Server-safe (no client JS). Pass a schema.org object (or array).
 */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // NOT trusted content: the church public page fills this from the
      // church's own name, About text, address and socials. scriptSafeJson
      // escapes `<` so none of it can close the element and run as script.
      dangerouslySetInnerHTML={{ __html: scriptSafeJson(data) }}
    />
  );
}
