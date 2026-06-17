-- Phase 4 Feature H.1 — Indian food database (additive).
--
-- IndianFoodItem is a seeded reference table (≥ 200 rows, GI/GL cited
-- per CLAUDE.md "IndianFoodItem"). MealLog gains an optional
-- `food_item_id` link — free-text `food_description` is untouched, so
-- meal logging never depends on a food row existing (see phase4.md
-- §H.3 fail-safe row: empty table → /foods/search returns [] and meals
-- accept free-text without a foodItemId).
--
-- DPDP / data-loss safety: `meal_logs.food_item_id` is ON DELETE SET
-- NULL — retiring or reseeding a food row never destroys a patient's
-- meal history. ON DELETE CASCADE only fires from the owning user row.
--
-- `name_regional` (JSONB { mr, ta, bn, te, gu, pa }) is populated only
-- as each regional-language flag ramps (Feature J). The GIN index at
-- the bottom (jsonb_path_ops) supports cross-language search once a
-- regional seed lands; Prisma cannot express the operator class, so it
-- is appended here by hand. Until then prefix search falls back to the
-- btree name_en / name_hi indexes.

-- CreateEnum
CREATE TYPE "FoodCategory" AS ENUM ('grain', 'lentil', 'vegetable', 'sweet', 'snack', 'beverage', 'fruit');

-- AlterTable
ALTER TABLE "meal_logs" ADD COLUMN     "food_item_id" UUID;

-- CreateTable
CREATE TABLE "indian_food_items" (
    "id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_hi" TEXT NOT NULL,
    "name_regional" JSONB NOT NULL DEFAULT '{}',
    "category" "FoodCategory" NOT NULL,
    "glycemic_index" INTEGER NOT NULL,
    "glycemic_load" DOUBLE PRECISION NOT NULL,
    "common_in_regions" TEXT[],
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indian_food_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "indian_food_items_name_en_key" ON "indian_food_items"("name_en");

-- CreateIndex
CREATE INDEX "indian_food_items_name_en_idx" ON "indian_food_items"("name_en");

-- CreateIndex
CREATE INDEX "indian_food_items_name_hi_idx" ON "indian_food_items"("name_hi");

-- CreateIndex
CREATE INDEX "indian_food_items_category_idx" ON "indian_food_items"("category");

-- CreateIndex
CREATE INDEX "meal_logs_user_id_food_item_id_logged_at_idx" ON "meal_logs"("user_id", "food_item_id", "logged_at");

-- AddForeignKey
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_food_item_id_fkey" FOREIGN KEY ("food_item_id") REFERENCES "indian_food_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex (manual — Prisma cannot express the jsonb_path_ops operator class)
-- Supports cross-language containment search on name_regional once a
-- regional-language seed lands (Feature J). Cheap on an empty/partial
-- JSONB column today; earns its keep when Marathi+ values populate.
CREATE INDEX "indian_food_items_name_regional_idx" ON "indian_food_items" USING gin ("name_regional" jsonb_path_ops);
