CREATE TABLE "usage_stat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"metric" text NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_stat" ADD CONSTRAINT "usage_stat_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_stat_unique" ON "usage_stat" USING btree ("church_id","metric","day");--> statement-breakpoint
CREATE INDEX "usage_stat_metric_idx" ON "usage_stat" USING btree ("metric");