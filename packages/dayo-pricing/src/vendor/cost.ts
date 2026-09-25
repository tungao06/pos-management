// cost.ts — ต้นทุนต่อหน่วย/เบส/แก้ว (DATA-CONTRACT §4.1, ADR-0026)
// รับโครงข้อมูลแบบเดียวกับ view v_variant_cost ใน Supabase — ต้องได้ตัวเลขเท่ากัน (กฎเหล็กข้อ 3)

import { round2 } from "./fmt";
import type { BaseEntry, IngredientEntry, RecipeLineEntry } from "./types";

/** ต้นทุนต่อหน่วยใช้ของวัตถุดิบ = ราคาซื้อ ÷ ตัวแปลง (ปกติคำนวณใน Supabase เป็น generated column แล้ว) */
export function ingredientCost(buyPrice: number, packToUseFactor: number): number {
  if (!packToUseFactor) return 0;
  return buyPrice / packToUseFactor;
}

/**
 * ต้นทุนต่อหน่วยของเบส = Σ(บรรทัด.qty × ต้นทุนวัตถุดิบ) ÷ ผลผลิต
 * ไม่ปัดเป็น 2 ตำแหน่งที่นี่ (ต่างจากเดิม) — ต้นทุน/หน่วยของเบสมักเล็กกว่า 0.05 บาท ปัดที่นี่ทำให้ต้นทุน/แก้วเพี้ยนสะสมเมื่อคูณด้วย qty มาก ๆ
 * ปัดเฉพาะผลรวมสุดท้ายที่ variantCost() (ตรงกับที่ชีต Excel เดิมคำนวณ — ปัดแค่คอลัมน์ "ต้นทุน/แก้ว")
 */
export function baseCost(base: BaseEntry, ingredients: Record<string, IngredientEntry>): number {
  if (!base.yieldQty) return 0;
  let total = 0;
  for (const line of base.lines) {
    const ing = ingredients[line.ingredientId];
    if (!ing) continue;
    total += line.qty * ing.costPerUseUnit;
  }
  return total / base.yieldQty;
}

export interface VariantCostResult {
  cost: number;
  liquidMl: number;
  gp: number | null;
}

/** ต้นทุนต่อแก้ว = Σ บรรทัดสูตร (qty × ต้นทุนของวัตถุดิบหรือเบส) · liquid_ml = Σ qty ของบรรทัดหน่วย ml */
export function variantCost(
  recipeLines: RecipeLineEntry[],
  ingredients: Record<string, IngredientEntry>,
  bases: Record<string, BaseEntry>,
  price?: number | null,
): VariantCostResult {
  let cost = 0;
  let liquidMl = 0;
  for (const line of recipeLines) {
    let unitCost = 0;
    if (line.ingredientId) {
      unitCost = ingredients[line.ingredientId]?.costPerUseUnit ?? 0;
    } else if (line.baseId) {
      const base = bases[line.baseId];
      unitCost = base ? baseCost(base, ingredients) : 0;
    }
    cost += line.qty * unitCost;
    if (line.unit === "ml") liquidMl += line.qty;
  }
  cost = round2(cost);
  const gp = price != null && price !== 0 ? (price - cost) / price : null;
  return { cost, liquidMl: round2(liquidMl), gp };
}
