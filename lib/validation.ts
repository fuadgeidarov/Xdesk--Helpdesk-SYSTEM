import { z } from "zod";

/**
 * bcrypt intentionally uses at most the first 72 password bytes. Reject longer
 * new passwords so two visually different passwords cannot share a truncated
 * bcrypt input. Character length can be lower than byte length for Unicode.
 */
export const newPasswordSchema = z
  .string()
  .min(8, "Пароль должен содержать минимум 8 символов")
  .max(128, "Пароль слишком длинный")
  .refine((value) => new TextEncoder().encode(value).byteLength <= 72, "Пароль должен занимать не более 72 байт");
