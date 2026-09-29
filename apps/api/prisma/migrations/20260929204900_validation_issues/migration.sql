-- CreateEnum
CREATE TYPE "ValidationIssueCode" AS ENUM ('LINE_ITEMS_SUBTOTAL_MISMATCH', 'TOTAL_MISMATCH', 'ROUNDING_ADJUSTMENT', 'POSSIBLE_DUPLICATE', 'UNUSUAL_AMOUNT');

-- CreateEnum
CREATE TYPE "ValidationSeverity" AS ENUM ('WARNING', 'INFO');

-- CreateTable
CREATE TABLE "ValidationIssue" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "extractionId" UUID NOT NULL,
    "code" "ValidationIssueCode" NOT NULL,
    "severity" "ValidationSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "relatedDocumentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ValidationIssue_extractionId_idx" ON "ValidationIssue"("extractionId");

-- CreateIndex
CREATE INDEX "ValidationIssue_businessId_code_idx" ON "ValidationIssue"("businessId", "code");

-- AddForeignKey
ALTER TABLE "ValidationIssue" ADD CONSTRAINT "ValidationIssue_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationIssue" ADD CONSTRAINT "ValidationIssue_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "Extraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationIssue" ADD CONSTRAINT "ValidationIssue_relatedDocumentId_fkey" FOREIGN KEY ("relatedDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
