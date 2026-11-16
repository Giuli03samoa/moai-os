-- AlterTable
ALTER TABLE "PaymentTransaction" ADD COLUMN     "fiscalDocAt" TIMESTAMP(3),
ADD COLUMN     "fiscalDocKind" TEXT,
ADD COLUMN     "fiscalDocRef" TEXT;
