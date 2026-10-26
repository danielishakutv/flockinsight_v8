ALTER TABLE "assistant_conversation" DROP CONSTRAINT "assistant_conversation_context_church_id_church_id_fk";
--> statement-breakpoint
ALTER TABLE "assistant_message" ADD COLUMN "call_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_context_church_id_church_id_fk" FOREIGN KEY ("context_church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_call_id_ai_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."ai_call"("id") ON DELETE set null ON UPDATE no action;