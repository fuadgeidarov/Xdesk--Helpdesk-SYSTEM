export const KNOWLEDGE_CATEGORIES = [
  "Общее",
  "Сеть",
  "ПО",
  "Оборудование",
  "Доступ",
  "Почта",
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export function isKnowledgeCategory(value: string): value is KnowledgeCategory {
  return (KNOWLEDGE_CATEGORIES as readonly string[]).includes(value);
}
