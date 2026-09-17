// Values fixed by decisions D16, D27, D29 and the Excel sheets "Lists", "เบสและซับสูตร".

// 2026-09-17 shop edit: sheet "ต้นทุนและราคา" header row (เมนู | ชื่อไทย | 16 oz | 20 oz | 22 oz)
// is now in natural column order — C=16oz, D=20oz, E=22oz. (Was C/E/D before the edit.)
export const SIZES = [
  { code: '16oz', name: '16 oz', sort: 1, packagingItemCode: 'PK-SET-16', priceCol: 3 }, // ต้นทุนและราคา!C
  { code: '20oz', name: '20 oz', sort: 2, packagingItemCode: 'PK-SET-20', priceCol: 4 }, // ต้นทุนและราคา!D
  { code: '22oz', name: '22 oz', sort: 3, packagingItemCode: 'PK-SET-22', priceCol: 5 }, // ต้นทุนและราคา!E
] as const

export const SWEETNESS = [
  { code: 'S000', name: '0%', sort: 1, isDefault: false },
  { code: 'S025', name: '25%', sort: 2, isDefault: false },
  { code: 'S050', name: '50%', sort: 3, isDefault: true },
  { code: 'S075', name: '75%', sort: 4, isDefault: false },
  { code: 'S100', name: '100%', sort: 5, isDefault: false },
] as const

export const CHANNELS = [
  { code: 'STORE', name: 'หน้าร้าน', commissionBp: 0 },
  { code: 'LINE_OA', name: 'LINE OA', commissionBp: 0 },
  { code: 'GRAB', name: 'Grab', commissionBp: 3000 },
  { code: 'LINE_MAN', name: 'LINE MAN', commissionBp: 3000 },
  { code: 'OTHER', name: 'อื่นๆ', commissionBp: 0 },
] as const

export const CATEGORIES = [
  { code: 'THAI', name: 'ชาไทย', sort: 1 },
  { code: 'GREEN', name: 'ชาเขียว', sort: 2 },
  { code: 'MATCHA', name: 'มัทฉะพรีเมียม', sort: 3 },
] as const

export const PRODUCT_CATEGORY: Record<string, string> = {
  Original: 'THAI', Latte: 'THAI', 'Cream Cheese': 'THAI', 'Whip Cheese': 'THAI', 'Orange Latte': 'THAI', Cocoa: 'THAI',
  'Thai Tea Frappe': 'THAI', 'Coconut Frappe': 'THAI', 'Honey Milk': 'THAI', 'Coconut Tea': 'THAI', 'Lemon Tea': 'THAI',
  'Green Tea': 'GREEN', 'Green Coconut': 'GREEN', 'Green Honey Milk': 'GREEN', 'Green Berry Soda': 'GREEN', 'Green Tea Frappe': 'GREEN',
  'Green Latte': 'GREEN', 'Green Lemon Tea': 'GREEN', 'Green Honey Lemon': 'GREEN', 'Green Cream Cheese': 'GREEN',
  'Pure Matcha Premium': 'MATCHA', 'Matcha Latte Premium': 'MATCHA', 'Matcha Coconut Premium': 'MATCHA', 'Matcha Strawberry Premium': 'MATCHA',
}

/** Prepared items (bases) — code, display name, use unit, shelf life from sheet "เบสและซับสูตร" (null = not stated). */
export const PREPARED_ITEMS = [
  { code: 'PB-TEA-THAI', name: 'ชาไทยเบส', excelName: 'ชาไทยเบส', useUnit: 'ml', shelfLifeHours: 72 },
  { code: 'PB-TEA-GREEN', name: 'ชาเขียวเบส', excelName: 'ชาเขียวเบส', useUnit: 'ml', shelfLifeHours: 24 },
  { code: 'PB-SYRUP', name: 'น้ำเชื่อม 1:1', excelName: 'น้ำเชื่อม 1:1', useUnit: 'ml', shelfLifeHours: 336 },
  { code: 'PB-HONEY', name: 'น้ำผึ้งเจือจาง 2:1', excelName: 'น้ำผึ้งเจือจาง 2:1', useUnit: 'ml', shelfLifeHours: null },
  { code: 'PB-COCONUT', name: 'เบสมะพร้าว', excelName: 'เบสมะพร้าว', useUnit: 'ml', shelfLifeHours: null },
  { code: 'PB-CHEESE-FOAM', name: 'ครีมชีสโฟม / วิปชีสโฟม', excelName: 'ครีมชีส/วิปชีสโฟม', useUnit: 'g', shelfLifeHours: 12 },
  { code: 'PB-MATCHA-SHOT', name: 'มัทฉะช็อต (1 g : 10 ml)', excelName: 'มัทฉะช็อต', useUnit: 'ml', shelfLifeHours: 4 },
] as const

export const PACKAGING_SETS = [
  { code: 'PK-SET-16', name: 'บรรจุภัณฑ์ 16 oz', excelName: 'บรรจุภัณฑ์ 16 oz' },
  { code: 'PK-SET-20', name: 'บรรจุภัณฑ์ 20 oz', excelName: 'บรรจุภัณฑ์ 20 oz' },
  { code: 'PK-SET-22', name: 'บรรจุภัณฑ์ 22 oz', excelName: 'บรรจุภัณฑ์ 22 oz' },
] as const

/** Header names in sheet "ข้อมูลสูตร" (unit suffix stripped) → item code. 1:1 aliases point straight at the raw item. */
export const RECIPE_INGREDIENT_TO_ITEM: Record<string, string> = {
  'ชาไทยเบส': 'PB-TEA-THAI',
  'ชาเขียวเบส': 'PB-TEA-GREEN',
  'นมสด': 'RM-MLK-01',
  'นมข้นจืด': 'RM-MLK-02',
  'นมข้นหวาน': 'RM-MLK-03',
  'น้ำเชื่อม': 'PB-SYRUP',
  'น้ำผึ้งเจือจาง': 'PB-HONEY',
  'โกโก้ผง': 'RM-POW-01',
  'น้ำส้มคั้น': 'RM-JUI-01',
  'เบสมะพร้าว': 'PB-COCONUT',
  'ซอสสตรอว์เบอร์รี่': 'RM-SAU-01',
  'น้ำมะนาว': 'RM-JUI-03',
  'โซดา': 'RM-SOD-01',
  'ครีมชีส/วิปชีส': 'PB-CHEESE-FOAM',
  'น้ำแข็ง': 'RM-WTR-01',
  'มัทฉะช็อต': 'PB-MATCHA-SHOT',
  'น้ำดื่ม': 'RM-WTR-03',
}

/** Sheet "ต้นทุนเบส" BOM column B names that are 1:1 aliases of a raw item — no BOM is created for them. */
export const BOM_ALIAS_NAMES = new Set(['นมสด', 'นมข้นจืด', 'นมข้นหวาน', 'โกโก้ผง', 'น้ำส้มคั้น', 'ซอสสตรอว์เบอร์รี่', 'น้ำมะนาว', 'โซดา', 'น้ำแข็ง', 'น้ำดื่ม'])

/** D29: costed but not counted. */
export const UNTRACKED_ITEM_CODES = new Set(['RM-WTR-01', 'RM-WTR-02', 'RM-WTR-03', 'RM-SEA-01'])
