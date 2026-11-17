-- CreateEnum
CREATE TYPE "MaterialKind" AS ENUM ('FABRIC', 'TRIM', 'LABEL', 'PRINT', 'PACKAGING', 'OTHER');

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN     "garmentSpecId" TEXT;

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT,
    "kind" "MaterialKind" NOT NULL DEFAULT 'FABRIC',
    "name" TEXT NOT NULL,
    "variant" TEXT,
    "composition" TEXT,
    "weightGsm" INTEGER,
    "widthCm" INTEGER,
    "unit" TEXT NOT NULL DEFAULT 'm',
    "unitPrice" DECIMAL(18,4),
    "invoiceMatch" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GarmentSpec" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "modelCode" TEXT,
    "makerId" TEXT,
    "composition" TEXT,
    "sewingCost" DECIMAL(18,4),
    "developmentCost" DECIMAL(18,4),
    "lotSize" INTEGER,
    "extraCost" DECIMAL(18,4),
    "extraCostNote" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GarmentSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GarmentComponent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "garmentId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "role" TEXT,
    "qtyPerUnit" DECIMAL(18,4),
    "estimated" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GarmentComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Material_organizationId_kind_idx" ON "Material"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "GarmentSpec_organizationId_idx" ON "GarmentSpec"("organizationId");

-- CreateIndex
CREATE INDEX "GarmentComponent_garmentId_idx" ON "GarmentComponent"("garmentId");

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_garmentSpecId_fkey" FOREIGN KEY ("garmentSpecId") REFERENCES "GarmentSpec"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarmentSpec" ADD CONSTRAINT "GarmentSpec_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarmentSpec" ADD CONSTRAINT "GarmentSpec_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarmentSpec" ADD CONSTRAINT "GarmentSpec_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarmentComponent" ADD CONSTRAINT "GarmentComponent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarmentComponent" ADD CONSTRAINT "GarmentComponent_garmentId_fkey" FOREIGN KEY ("garmentId") REFERENCES "GarmentSpec"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarmentComponent" ADD CONSTRAINT "GarmentComponent_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
