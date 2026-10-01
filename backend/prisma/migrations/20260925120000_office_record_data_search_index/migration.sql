-- Records-page search (?q=) also matches record field values via
-- data::text ILIKE (services/officeRecordList.ts). Assessor's EGAPS owner
-- import put 116k rows in one module, so back it with a trigram index
-- (pg_trgm is enabled by the initial migration).
CREATE INDEX IF NOT EXISTS "office_record_data_trgm" ON "office_record" USING gin ((data::text) gin_trgm_ops);
