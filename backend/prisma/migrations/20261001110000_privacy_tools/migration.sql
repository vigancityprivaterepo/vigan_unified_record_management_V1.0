-- Privacy tools (RA 10173): data subject requests, and fast lookup of audit
-- entries that list the people shown (changed_fields.personKeys), for a
-- citizen's "who viewed this record" history.
CREATE TABLE "data_request" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_key" UUID,
    "requester_name" TEXT NOT NULL,
    "contact" TEXT,
    "kind" TEXT NOT NULL,
    "details" TEXT,
    "received_on" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "response" TEXT,
    "closed_on" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "data_request_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "data_request_kind_check" CHECK ("kind" IN ('access', 'correction', 'erasure', 'objection', 'other')),
    CONSTRAINT "data_request_status_check" CHECK ("status" IN ('open', 'done', 'declined'))
);
CREATE INDEX "data_request_person_key_idx" ON "data_request" ("person_key");

-- Admin only, and no DELETE: requests are kept as the record of compliance.
GRANT SELECT, INSERT, UPDATE ON "data_request" TO admin;

CREATE INDEX "audit_log_person_keys_idx" ON "audit_log" USING gin ((changed_fields -> 'personKeys') jsonb_path_ops);
