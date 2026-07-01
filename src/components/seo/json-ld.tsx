/**
 * Renders a JSON-LD structured-data <script> for rich results on Google.
 * Server-safe (no client JS). Pass a schema.org object (or array).
 */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // Structured data is trusted, developer-authored content.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
