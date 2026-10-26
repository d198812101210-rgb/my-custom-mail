CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"resend_attachment_id" text,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"content_id" text,
	"disposition" text,
	"storage_path" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"resend_id" text,
	"direction" text NOT NULL,
	"message_id_header" text,
	"in_reply_to" text,
	"references_header" text,
	"from_address" text NOT NULL,
	"from_name" text,
	"to_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
	"cc" text[] DEFAULT '{}'::text[] NOT NULL,
	"bcc" text[] DEFAULT '{}'::text[] NOT NULL,
	"received_for" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"text_body" text,
	"html_body" text,
	"headers" jsonb,
	"spf" text,
	"dkim" text,
	"dmarc" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"folder" text DEFAULT 'inbox' NOT NULL,
	"sent_or_received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', translate(coalesce(subject, '') || ' ' || coalesce(text_body, '') || ' ' || coalesce(from_address, '') || ' ' || coalesce(from_name, ''), '@._-/', '     '))) STORED,
	CONSTRAINT "messages_direction_check" CHECK ("messages"."direction" in ('in', 'out')),
	CONSTRAINT "messages_folder_check" CHECK ("messages"."folder" in ('inbox', 'archive', 'trash', 'sent'))
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "otp_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_subject" text NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"participants" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_message_idx" ON "attachments" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_message_resend_key" ON "attachments" USING btree ("message_id","resend_attachment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_resend_id_key" ON "messages" USING btree ("resend_id");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id","sent_or_received_at");--> statement-breakpoint
CREATE INDEX "messages_folder_idx" ON "messages" USING btree ("folder","sent_or_received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_message_id_header_idx" ON "messages" USING btree ("message_id_header");--> statement-breakpoint
CREATE INDEX "messages_search_idx" ON "messages" USING gin ("search");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "threads_last_message_at_idx" ON "threads" USING btree ("last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "threads_subject_idx" ON "threads" USING btree ("normalized_subject");