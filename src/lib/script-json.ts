/**
 * JSON that is safe to drop inside an HTML <script> element.
 *
 * `JSON.stringify` does not escape `<`, and the HTML tokenizer ends a script
 * element at the first `</script` it meets — whatever the `type` attribute
 * says. A church's About text of `</script><script>…</script>` therefore
 * closed the JSON-LD block on its public page and ran as an ordinary script
 * on flockinsight.com, with the cookies of whoever opened the link.
 *
 * Escaping `<`, `>` and `&` as `<` etc. keeps it valid JSON that parses
 * back to exactly the same value (Google reads the same structured data), and
 * leaves nothing the HTML parser can act on. U+2028 / U+2029 are escaped too:
 * they are legal in JSON strings but were line terminators in JavaScript
 * before ES2019, so an older parser treating the block as script would choke.
 *
 * Escape at the sink, not at input: a church may legitimately write "<3".
 */
export function scriptSafeJson(data: unknown): string {
  // JSON.stringify(undefined) is undefined, not a string.
  const json = JSON.stringify(data) ?? "null";
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
