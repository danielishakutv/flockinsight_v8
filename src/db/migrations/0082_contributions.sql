CREATE TYPE "public"."contribution_approval_decision" AS ENUM('confirm', 'dispute');--> statement-breakpoint
CREATE TYPE "public"."contribution_entry_source" AS ENUM('recorded', 'self');--> statement-breakpoint
CREATE TYPE "public"."contribution_entry_status" AS ENUM('pending', 'confirmed', 'disputed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."contribution_kind" AS ENUM('equal', 'open', 'gift');--> statement-breakpoint
CREATE TYPE "public"."contribution_payout_kind" AS ENUM('handover', 'expense', 'withdrawal', 'refund');--> statement-breakpoint
CREATE TYPE "public"."contribution_payout_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."contribution_status" AS ENUM('draft', 'open', 'closed', 'settled');--> statement-breakpoint
CREATE TYPE "public"."contribution_visibility" AS ENUM('private', 'summary', 'detailed');--> statement-breakpoint
CREATE TABLE "contribution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"group_id" uuid,
	"title" text NOT NULL,
	"purpose" text,
	"kind" "contribution_kind" DEFAULT 'open' NOT NULL,
	"status" "contribution_status" DEFAULT 'draft' NOT NULL,
	"slug" text NOT NULL,
	"target_amount" numeric(14, 2),
	"per_person_amount" numeric(14, 2),
	"pay_instructions" text,
	"honouree_member_id" uuid,
	"honouree_name" text,
	"start_date" date,
	"due_date" date,
	"visibility" "contribution_visibility" DEFAULT 'detailed' NOT NULL,
	"show_outstanding" boolean DEFAULT false NOT NULL,
	"show_payouts" boolean DEFAULT true NOT NULL,
	"show_notes" boolean DEFAULT true NOT NULL,
	"allow_self_report" boolean DEFAULT true NOT NULL,
	"ask_for_proof" boolean DEFAULT true NOT NULL,
	"confirmations_required" integer DEFAULT 1 NOT NULL,
	"payout_approvals_required" integer DEFAULT 2 NOT NULL,
	"keep_proofs" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"goal_reached_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "contribution_approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" text NOT NULL,
	"entry_id" uuid,
	"payout_id" uuid,
	"decision" "contribution_approval_decision" NOT NULL,
	"user_id" text,
	"actor_name" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_approval_one_target" CHECK (("contribution_approval"."entry_id" is null) <> ("contribution_approval"."payout_id" is null))
);
--> statement-breakpoint
CREATE TABLE "contribution_contributor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"church_id" text NOT NULL,
	"member_id" uuid,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"expected_amount" numeric(14, 2),
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"note" text,
	"match_dismissed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contribution_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"church_id" text NOT NULL,
	"contributor_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"method" "giving_method",
	"paid_on" date NOT NULL,
	"reference" text,
	"note" text,
	"status" "contribution_entry_status" DEFAULT 'pending' NOT NULL,
	"source" "contribution_entry_source" DEFAULT 'recorded' NOT NULL,
	"proof_media_id" uuid,
	"proof_released_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"resolution_note" text,
	"recorded_by" text,
	"recorded_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contribution_payout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"church_id" text NOT NULL,
	"kind" "contribution_payout_kind" DEFAULT 'expense' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid_on" date NOT NULL,
	"payee" text,
	"purpose" text,
	"method" "giving_method",
	"reference" text,
	"status" "contribution_payout_status" DEFAULT 'pending' NOT NULL,
	"proof_media_id" uuid,
	"proof_released_at" timestamp with time zone,
	"finance_transaction_id" uuid,
	"approved_at" timestamp with time zone,
	"resolution_note" text,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contribution" ADD CONSTRAINT "contribution_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution" ADD CONSTRAINT "contribution_group_id_church_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."church_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution" ADD CONSTRAINT "contribution_honouree_member_id_member_id_fk" FOREIGN KEY ("honouree_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution" ADD CONSTRAINT "contribution_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_approval" ADD CONSTRAINT "contribution_approval_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_approval" ADD CONSTRAINT "contribution_approval_entry_id_contribution_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."contribution_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_approval" ADD CONSTRAINT "contribution_approval_payout_id_contribution_payout_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."contribution_payout"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_approval" ADD CONSTRAINT "contribution_approval_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_contributor" ADD CONSTRAINT "contribution_contributor_contribution_id_contribution_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contribution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_contributor" ADD CONSTRAINT "contribution_contributor_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_contributor" ADD CONSTRAINT "contribution_contributor_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_entry" ADD CONSTRAINT "contribution_entry_contribution_id_contribution_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contribution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_entry" ADD CONSTRAINT "contribution_entry_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_entry" ADD CONSTRAINT "contribution_entry_contributor_id_contribution_contributor_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contribution_contributor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_entry" ADD CONSTRAINT "contribution_entry_proof_media_id_media_id_fk" FOREIGN KEY ("proof_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_entry" ADD CONSTRAINT "contribution_entry_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_payout" ADD CONSTRAINT "contribution_payout_contribution_id_contribution_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contribution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_payout" ADD CONSTRAINT "contribution_payout_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_payout" ADD CONSTRAINT "contribution_payout_proof_media_id_media_id_fk" FOREIGN KEY ("proof_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_payout" ADD CONSTRAINT "contribution_payout_finance_transaction_id_finance_transaction_id_fk" FOREIGN KEY ("finance_transaction_id") REFERENCES "public"."finance_transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_payout" ADD CONSTRAINT "contribution_payout_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contribution_church_idx" ON "contribution" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "contribution_group_idx" ON "contribution" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "contribution_church_status_idx" ON "contribution" USING btree ("church_id","status");--> statement-breakpoint
CREATE INDEX "contribution_approval_entry_idx" ON "contribution_approval" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "contribution_approval_payout_idx" ON "contribution_approval" USING btree ("payout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_approval_entry_user_unique" ON "contribution_approval" USING btree ("entry_id","user_id") WHERE "contribution_approval"."entry_id" is not null and "contribution_approval"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_approval_payout_user_unique" ON "contribution_approval" USING btree ("payout_id","user_id") WHERE "contribution_approval"."payout_id" is not null and "contribution_approval"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "contribution_contributor_pot_idx" ON "contribution_contributor" USING btree ("contribution_id");--> statement-breakpoint
CREATE INDEX "contribution_contributor_church_idx" ON "contribution_contributor" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "contribution_contributor_member_idx" ON "contribution_contributor" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_contributor_member_unique" ON "contribution_contributor" USING btree ("contribution_id","member_id") WHERE "contribution_contributor"."member_id" is not null;--> statement-breakpoint
CREATE INDEX "contribution_entry_pot_idx" ON "contribution_entry" USING btree ("contribution_id");--> statement-breakpoint
CREATE INDEX "contribution_entry_church_idx" ON "contribution_entry" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "contribution_entry_contributor_idx" ON "contribution_entry" USING btree ("contributor_id");--> statement-breakpoint
CREATE INDEX "contribution_entry_pot_status_idx" ON "contribution_entry" USING btree ("contribution_id","status");--> statement-breakpoint
CREATE INDEX "contribution_entry_paid_idx" ON "contribution_entry" USING btree ("paid_on");--> statement-breakpoint
CREATE INDEX "contribution_payout_pot_idx" ON "contribution_payout" USING btree ("contribution_id");--> statement-breakpoint
CREATE INDEX "contribution_payout_church_idx" ON "contribution_payout" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "contribution_payout_pot_status_idx" ON "contribution_payout" USING btree ("contribution_id","status");