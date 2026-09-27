-- CreateEnum
CREATE TYPE "PipelineStepName" AS ENUM ('CLASSIFICATION', 'EXTRACTION', 'VALIDATION', 'CATEGORIZATION');

-- CreateEnum
CREATE TYPE "PipelineStepStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "PipelineStep" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "extractionId" UUID NOT NULL,
    "name" "PipelineStepName" NOT NULL,
    "status" "PipelineStepStatus" NOT NULL DEFAULT 'RUNNING',
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "error" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PipelineStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineStep_businessId_name_status_idx" ON "PipelineStep"("businessId", "name", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStep_extractionId_name_key" ON "PipelineStep"("extractionId", "name");

-- AddForeignKey
ALTER TABLE "PipelineStep" ADD CONSTRAINT "PipelineStep_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStep" ADD CONSTRAINT "PipelineStep_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "Extraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
