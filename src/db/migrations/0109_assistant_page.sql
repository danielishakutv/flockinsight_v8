CREATE TABLE "assistant_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" text NOT NULL,
	"subject" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_usage_used_nonneg" CHECK ("assistant_usage"."used" >= 0)
);
--> statement-breakpoint
ALTER TABLE "assistant_message" DROP CONSTRAINT "assistant_message_kind_chk";--> statement-breakpoint
ALTER TABLE "ai_church_setting" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN "context_church_id" text;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD COLUMN "mode" text DEFAULT 'help' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD COLUMN "figures_ok" boolean;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD COLUMN "saved_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_usage_period_subject_idx" ON "assistant_usage" USING btree ("period","subject");--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_context_church_id_church_id_fk" FOREIGN KEY ("context_church_id") REFERENCES "public"."church"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_message_saved_idx" ON "assistant_message" USING btree ("user_id","saved_at") WHERE "assistant_message"."saved_at" is not null;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_mode_chk" CHECK ("assistant_message"."mode" in ('help','advisor'));--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_kind_chk" CHECK ((("assistant_message"."role" = 'assistant') = ("assistant_message"."answer_kind" is not null)) and ("assistant_message"."answer_kind" is null or "assistant_message"."answer_kind" in ('answered','not_in_guides','refused','truncated','failed','out_of_scope')));