-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'TECHNICIAN', 'VIEWER');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('PENDING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "TrustVerdict" AS ENUM ('TRUSTED', 'TRUSTED_WITH_NOTES', 'CAUTION', 'UNTRUSTED', 'INSUFFICIENT_EVIDENCE');

-- CreateEnum
CREATE TYPE "ModuleId" AS ENUM ('IDENTITY', 'HARDWARE_CONSISTENCY', 'SERVICE_EVIDENCE', 'BATTERY_INTELLIGENCE', 'SECURITY_DNA', 'TRUST');

-- CreateEnum
CREATE TYPE "Determinacy" AS ENUM ('DETERMINED', 'INDETERMINATE');

-- CreateEnum
CREATE TYPE "FindingBasis" AS ENUM ('EVIDENCE', 'ABSENCE');

-- CreateEnum
CREATE TYPE "EvidenceSubject" AS ENUM ('DEVICE', 'SYSTEM_SOFTWARE', 'SECURITY_STATE', 'BATTERY', 'DISPLAY', 'REAR_CAMERA', 'FRONT_CAMERA', 'FACE_ID', 'TOUCH_ID', 'LOGIC_BOARD', 'REAR_HOUSING', 'LIDAR', 'SPEAKER', 'MICROPHONE', 'TAPTIC_ENGINE');

-- CreateEnum
CREATE TYPE "ServiceVerdict" AS ENUM ('ORIGINAL_LIKELY', 'REPLACED_LIKELY', 'CANNOT_DETERMINE');

-- CreateEnum
CREATE TYPE "PartAuthenticity" AS ENUM ('GENUINE_APPLE', 'GENUINE_TRANSPLANTED', 'NOT_VERIFIED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "identifierSalt" TEXT NOT NULL,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'TECHNICIAN',
    "lastLoginAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_registrations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workstation" TEXT,
    "platform" TEXT,
    "version" TEXT,
    "tokenHash" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bridge_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_nonces" (
    "id" TEXT NOT NULL,
    "bridgeId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bridge_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "udidHash" TEXT NOT NULL,
    "serialHash" TEXT,
    "udid" TEXT,
    "serialNumber" TEXT,
    "productType" TEXT NOT NULL,
    "marketingName" TEXT NOT NULL,
    "capacityGb" INTEGER,
    "regionCode" TEXT,
    "regionName" TEXT,
    "colorHint" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inspectionCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT,
    "bridgeId" TEXT,
    "customerId" TEXT,
    "status" "InspectionStatus" NOT NULL DEFAULT 'COMPLETE',
    "trustVerdict" "TrustVerdict" NOT NULL,
    "trustScore" INTEGER NOT NULL,
    "rawTrustScore" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "coverage" DOUBLE PRECISION NOT NULL,
    "identityVerdict" TEXT,
    "hardwareVerdict" TEXT,
    "securityVerdict" TEXT,
    "batteryVerdict" TEXT,
    "batteryHealthPercent" INTEGER,
    "batteryCycleCount" INTEGER,
    "batteryWearGrade" TEXT,
    "batteryReplacementRisk" DOUBLE PRECISION,
    "securityPostureScore" INTEGER,
    "hardwareAnomalyCount" INTEGER NOT NULL DEFAULT 0,
    "componentsReplacedCount" INTEGER NOT NULL DEFAULT 0,
    "componentsIndeterminate" INTEGER NOT NULL DEFAULT 0,
    "iosVersion" TEXT,
    "buildVersion" TEXT,
    "unitProvenance" TEXT,
    "engineVersion" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "ledgerDigest" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_records" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" "EvidenceSubject" NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "sourceAuthority" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "collector" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "reliability" DOUBLE PRECISION NOT NULL,
    "instrument" TEXT,
    "raw" TEXT,
    "note" TEXT,

    CONSTRAINT "evidence_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inferences" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "inferenceId" TEXT NOT NULL,
    "module" "ModuleId" NOT NULL,
    "rule" TEXT NOT NULL,
    "subject" "EvidenceSubject" NOT NULL,
    "direction" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidenceIds" TEXT[],
    "derivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_verdicts" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "verdictId" TEXT NOT NULL,
    "module" "ModuleId" NOT NULL,
    "subject" "EvidenceSubject" NOT NULL,
    "value" TEXT NOT NULL,
    "determinacy" "Determinacy" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT NOT NULL,
    "inferenceIds" TEXT[],
    "evidenceIds" TEXT[],

    CONSTRAINT "module_verdicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "component_service_results" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "subject" "EvidenceSubject" NOT NULL,
    "verdict" "ServiceVerdict" NOT NULL,
    "authenticity" "PartAuthenticity" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT NOT NULL,

    CONSTRAINT "component_service_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_entries" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "refs" JSONB NOT NULL,

    CONSTRAINT "audit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "module" "ModuleId" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "basis" "FindingBasis" NOT NULL,
    "evidenceIds" TEXT[],
    "inferenceIds" TEXT[],

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'pdf',
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "bridge_registrations_tokenHash_key" ON "bridge_registrations"("tokenHash");

-- CreateIndex
CREATE INDEX "bridge_registrations_organizationId_idx" ON "bridge_registrations"("organizationId");

-- CreateIndex
CREATE INDEX "bridge_nonces_expiresAt_idx" ON "bridge_nonces"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "bridge_nonces_bridgeId_nonce_key" ON "bridge_nonces"("bridgeId", "nonce");

-- CreateIndex
CREATE INDEX "devices_organizationId_lastSeenAt_idx" ON "devices"("organizationId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "devices_organizationId_udidHash_key" ON "devices"("organizationId", "udidHash");

-- CreateIndex
CREATE INDEX "customers_organizationId_idx" ON "customers"("organizationId");

-- CreateIndex
CREATE INDEX "inspections_organizationId_createdAt_idx" ON "inspections"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "inspections_organizationId_trustVerdict_idx" ON "inspections"("organizationId", "trustVerdict");

-- CreateIndex
CREATE INDEX "inspections_deviceId_createdAt_idx" ON "inspections"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "evidence_records_inspectionId_subject_idx" ON "evidence_records"("inspectionId", "subject");

-- CreateIndex
CREATE INDEX "evidence_records_key_idx" ON "evidence_records"("key");

-- CreateIndex
CREATE INDEX "evidence_records_sourceAuthority_method_idx" ON "evidence_records"("sourceAuthority", "method");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_records_inspectionId_evidenceId_key" ON "evidence_records"("inspectionId", "evidenceId");

-- CreateIndex
CREATE INDEX "inferences_inspectionId_module_idx" ON "inferences"("inspectionId", "module");

-- CreateIndex
CREATE INDEX "inferences_rule_idx" ON "inferences"("rule");

-- CreateIndex
CREATE UNIQUE INDEX "inferences_inspectionId_inferenceId_key" ON "inferences"("inspectionId", "inferenceId");

-- CreateIndex
CREATE INDEX "module_verdicts_inspectionId_module_idx" ON "module_verdicts"("inspectionId", "module");

-- CreateIndex
CREATE INDEX "module_verdicts_module_value_idx" ON "module_verdicts"("module", "value");

-- CreateIndex
CREATE UNIQUE INDEX "module_verdicts_inspectionId_verdictId_key" ON "module_verdicts"("inspectionId", "verdictId");

-- CreateIndex
CREATE INDEX "component_service_results_inspectionId_idx" ON "component_service_results"("inspectionId");

-- CreateIndex
CREATE INDEX "component_service_results_subject_verdict_idx" ON "component_service_results"("subject", "verdict");

-- CreateIndex
CREATE INDEX "component_service_results_subject_authenticity_idx" ON "component_service_results"("subject", "authenticity");

-- CreateIndex
CREATE INDEX "audit_entries_inspectionId_sequence_idx" ON "audit_entries"("inspectionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "audit_entries_inspectionId_sequence_key" ON "audit_entries"("inspectionId", "sequence");

-- CreateIndex
CREATE INDEX "findings_inspectionId_idx" ON "findings"("inspectionId");

-- CreateIndex
CREATE INDEX "findings_code_idx" ON "findings"("code");

-- CreateIndex
CREATE INDEX "findings_module_severity_idx" ON "findings"("module", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "reports_publicId_key" ON "reports"("publicId");

-- CreateIndex
CREATE INDEX "reports_organizationId_createdAt_idx" ON "reports"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_organizationId_idx" ON "api_keys"("organizationId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_registrations" ADD CONSTRAINT "bridge_registrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_nonces" ADD CONSTRAINT "bridge_nonces_bridgeId_fkey" FOREIGN KEY ("bridgeId") REFERENCES "bridge_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_bridgeId_fkey" FOREIGN KEY ("bridgeId") REFERENCES "bridge_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inferences" ADD CONSTRAINT "inferences_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_verdicts" ADD CONSTRAINT "module_verdicts_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "component_service_results" ADD CONSTRAINT "component_service_results_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
