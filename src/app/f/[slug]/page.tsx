import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, form } from "@/db/schema";
import { type FormField } from "@/lib/forms-shared";
import { FormSubmit } from "@/components/forms/form-submit";

export const dynamic = "force-dynamic";

async function getForm(slug: string) {
  const [f] = await db
    .select({
      id: form.id,
      churchId: form.churchId,
      title: form.title,
      description: form.description,
      status: form.status,
      fields: form.fields,
    })
    .from(form)
    .where(eq(form.slug, slug))
    .limit(1);
  return f ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const f = await getForm(slug);
  if (!f || f.status === "draft") return { title: "Form not found" };
  return {
    title: f.title,
    description: f.description ?? undefined,
    robots: { index: false }, // forms shouldn't be search-indexed
  };
}

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const f = await getForm(slug);
  if (!f || f.status === "draft") notFound();

  const [c] = await db
    .select({ name: church.name, logo: church.logo })
    .from(church)
    .where(eq(church.id, f.churchId))
    .limit(1);

  const fields = (f.fields ?? []) as FormField[];

  return (
    <div className="bg-muted/40 min-h-dvh">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 lg:py-12">
        {/* Church header */}
        <div className="mb-6 flex items-center gap-3">
          {c?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.logo}
              alt=""
              className="size-12 shrink-0 rounded-xl border object-cover"
            />
          ) : null}
          <p className="font-semibold">{c?.name ?? "FlockInsight"}</p>
        </div>

        {/* Form header */}
        <div className="bg-card border-t-primary mb-4 rounded-2xl border border-t-4 p-6">
          <h1 className="text-2xl font-extrabold tracking-tight">{f.title}</h1>
          {f.description && (
            <p className="text-muted-foreground mt-2 whitespace-pre-wrap">
              {f.description}
            </p>
          )}
        </div>

        {f.status === "closed" ? (
          <div className="bg-card rounded-2xl border p-8 text-center">
            <p className="text-lg font-semibold">
              This form is no longer accepting responses.
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              Please contact {c?.name ?? "the church"} if you need help.
            </p>
          </div>
        ) : fields.length === 0 ? (
          <div className="bg-card text-muted-foreground rounded-2xl border p-8 text-center">
            This form doesn&apos;t have any questions yet.
          </div>
        ) : (
          <FormSubmit slug={slug} fields={fields} />
        )}

        <p className="text-muted-foreground mt-8 text-center text-xs">
          Powered by FlockInsight
        </p>
      </div>
    </div>
  );
}
