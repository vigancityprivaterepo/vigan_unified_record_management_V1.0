-- Expands the fixed field-type palette admin can pick from when defining a
-- module's extra intake fields -- was TEXT/NUMBER/DATE/BOOLEAN/SELECT/FILE,
-- offices asked for more range without opening this up to arbitrary types
-- (see dynamicFieldSchema.ts's own comment on why this stays a fixed list,
-- not a free-form type system). No data in this migration uses these new
-- values -- same reasoning as FILE's own addition in 20260827150000, this
-- can be one migration instead of the ADD-VALUE-then-use split that
-- 20260827100000/20260827100100 needed.
ALTER TYPE "OfficeFieldType" ADD VALUE 'MULTISELECT';
ALTER TYPE "OfficeFieldType" ADD VALUE 'TEXTAREA';
ALTER TYPE "OfficeFieldType" ADD VALUE 'EMAIL';
ALTER TYPE "OfficeFieldType" ADD VALUE 'PHONE';
ALTER TYPE "OfficeFieldType" ADD VALUE 'TIME';
