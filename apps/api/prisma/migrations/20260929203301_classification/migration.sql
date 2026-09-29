-- CreateEnum
CREATE TYPE "VendorCategory" AS ENUM ('TRANSPORT', 'FOOD_AND_DRINK', 'GROCERIES', 'RETAIL', 'SOFTWARE_AND_SUBSCRIPTIONS', 'UTILITIES_AND_TELECOM', 'TRAVEL_AND_LODGING', 'PROFESSIONAL_SERVICES', 'HEALTH', 'OTHER');

-- AlterTable
ALTER TABLE "Extraction" ADD COLUMN     "classificationReason" TEXT,
ADD COLUMN     "documentTypeConfidence" DOUBLE PRECISION,
ADD COLUMN     "vendorCategory" "VendorCategory";

-- AlterTable
ALTER TABLE "PipelineStep" ADD COLUMN     "promptVersion" TEXT;

-- Added by hand (Prisma can't express CHECK constraints): keep in sync with
-- the 0–1 range enforced on ExtractionField.confidence.
ALTER TABLE "Extraction" ADD CONSTRAINT "Extraction_documentTypeConfidence_range"
  CHECK ("documentTypeConfidence" IS NULL OR ("documentTypeConfidence" >= 0 AND "documentTypeConfidence" <= 1));
