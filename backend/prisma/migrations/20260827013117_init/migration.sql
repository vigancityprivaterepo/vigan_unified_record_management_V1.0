-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('insert', 'update', 'delete', 'read', 'merge');

-- CreateTable
CREATE TABLE "barangay" (
    "code" VARCHAR(10) NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "barangay_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Citizen" (
    "person_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_parent_key" UUID,
    "person_sub_parent_key" UUID,
    "person_is_head" BOOLEAN NOT NULL DEFAULT false,
    "person_relation_to_head" TEXT,
    "person_lname" TEXT NOT NULL,
    "person_fname" TEXT NOT NULL,
    "person_mname" TEXT,
    "person_street" TEXT,
    "person_brgy_code" VARCHAR(10),
    "person_sex" TEXT,
    "person_gender" TEXT,
    "person_bdate" DATE,
    "person_civil_status" TEXT,
    "person_religion" TEXT,
    "person_educ_level" TEXT,
    "person_educ_course" TEXT,
    "person_occupation" TEXT,
    "person_occupation_industry" TEXT,
    "person_occupation_bus_name" TEXT,
    "person_occupation_bus_address" TEXT,
    "person_sss_enc" BYTEA,
    "person_gsis_enc" BYTEA,
    "person_philhealth_enc" BYTEA,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Citizen_pkey" PRIMARY KEY ("person_key")
);

-- CreateTable
CREATE TABLE "Persons_Senior" (
    "sn_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_key" UUID NOT NULL,
    "sn_commorbidity" TEXT,
    "sn_is_have_id" BOOLEAN,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "Persons_Senior_pkey" PRIMARY KEY ("sn_key")
);

-- CreateTable
CREATE TABLE "Persons_PWD" (
    "pwd_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_key" UUID NOT NULL,
    "pwd_type_of_disability" TEXT,
    "pwd_commorbidity" TEXT,
    "pwd_is_have_id" BOOLEAN,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "Persons_PWD_pkey" PRIMARY KEY ("pwd_key")
);

-- CreateTable
CREATE TABLE "Persons_Solo_Parent" (
    "sp_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_key" UUID NOT NULL,
    "sp_number_of_children" INTEGER,
    "sp_is_have_id" BOOLEAN,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "Persons_Solo_Parent_pkey" PRIMARY KEY ("sp_key")
);

-- CreateTable
CREATE TABLE "Persons_Farmer" (
    "farmer_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_key" UUID NOT NULL,
    "farmer_is_senior" BOOLEAN,
    "farmer_is_pwd" BOOLEAN,
    "farmer_location_of_farm" TEXT,
    "farmer_size_of_farm" DECIMAL(10,4),
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "Persons_Farmer_pkey" PRIMARY KEY ("farmer_key")
);

-- CreateTable
CREATE TABLE "Person_Birth" (
    "birth_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_key" UUID,
    "birth_lname" TEXT NOT NULL,
    "birth_fname" TEXT NOT NULL,
    "birth_mname" TEXT,
    "birth_bdate" DATE NOT NULL,
    "birth_bplace" TEXT,
    "birth_mother" TEXT,
    "birth_father" TEXT,
    "birth_order" INTEGER,
    "birth_is_from_vigan" BOOLEAN NOT NULL DEFAULT false,
    "birth_upload_doc" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "Person_Birth_pkey" PRIMARY KEY ("birth_key")
);

-- CreateTable
CREATE TABLE "Person_Death" (
    "death_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_key" UUID NOT NULL,
    "death_ddate" DATE NOT NULL,
    "death_place_of_death" TEXT,
    "death_cause_of_death" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "Person_Death_pkey" PRIMARY KEY ("death_key")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "table_name" TEXT NOT NULL,
    "record_id" UUID,
    "action" "AuditAction" NOT NULL,
    "actor_user_id" UUID,
    "actor_role" TEXT,
    "changed_fields" JSONB,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "barangay_name_key" ON "barangay"("name");

-- CreateIndex
CREATE INDEX "Citizen_person_lname_person_fname_person_bdate_idx" ON "Citizen"("person_lname", "person_fname", "person_bdate");

-- CreateIndex
CREATE INDEX "Persons_Senior_person_key_idx" ON "Persons_Senior"("person_key");

-- CreateIndex
CREATE INDEX "Persons_PWD_person_key_idx" ON "Persons_PWD"("person_key");

-- CreateIndex
CREATE INDEX "Persons_Solo_Parent_person_key_idx" ON "Persons_Solo_Parent"("person_key");

-- CreateIndex
CREATE INDEX "Persons_Farmer_person_key_idx" ON "Persons_Farmer"("person_key");

-- CreateIndex
CREATE INDEX "Person_Birth_person_key_idx" ON "Person_Birth"("person_key");

-- CreateIndex
CREATE INDEX "Person_Death_person_key_idx" ON "Person_Death"("person_key");

-- CreateIndex
CREATE INDEX "audit_log_table_name_record_id_idx" ON "audit_log"("table_name", "record_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log"("actor_user_id");

-- AddForeignKey
ALTER TABLE "Citizen" ADD CONSTRAINT "Citizen_person_brgy_code_fkey" FOREIGN KEY ("person_brgy_code") REFERENCES "barangay"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citizen" ADD CONSTRAINT "Citizen_person_parent_key_fkey" FOREIGN KEY ("person_parent_key") REFERENCES "Citizen"("person_key") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citizen" ADD CONSTRAINT "Citizen_person_sub_parent_key_fkey" FOREIGN KEY ("person_sub_parent_key") REFERENCES "Citizen"("person_key") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Persons_Senior" ADD CONSTRAINT "Persons_Senior_person_key_fkey" FOREIGN KEY ("person_key") REFERENCES "Citizen"("person_key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Persons_PWD" ADD CONSTRAINT "Persons_PWD_person_key_fkey" FOREIGN KEY ("person_key") REFERENCES "Citizen"("person_key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Persons_Solo_Parent" ADD CONSTRAINT "Persons_Solo_Parent_person_key_fkey" FOREIGN KEY ("person_key") REFERENCES "Citizen"("person_key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Persons_Farmer" ADD CONSTRAINT "Persons_Farmer_person_key_fkey" FOREIGN KEY ("person_key") REFERENCES "Citizen"("person_key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person_Birth" ADD CONSTRAINT "Person_Birth_person_key_fkey" FOREIGN KEY ("person_key") REFERENCES "Citizen"("person_key") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person_Death" ADD CONSTRAINT "Person_Death_person_key_fkey" FOREIGN KEY ("person_key") REFERENCES "Citizen"("person_key") ON DELETE RESTRICT ON UPDATE CASCADE;
