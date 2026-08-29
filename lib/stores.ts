// Example locations for the public template.
// Replace these values with your own branches/stores before production use.
export const stores = [
  "Магазин 1",
  "Магазин 2",
  "Магазин 3",
  "Офис",
  "Склад",
  "Производство",
] as const;

export type Store = (typeof stores)[number];

export function isStore(value: unknown): value is Store {
  return typeof value === "string" && (stores as readonly string[]).includes(value);
}
