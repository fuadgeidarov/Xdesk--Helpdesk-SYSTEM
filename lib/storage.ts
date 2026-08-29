import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

// Uploaded files are stored outside the Next.js build output so they survive
// rebuilds. In Docker this directory is a mounted volume (see docker-compose.yml).
const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

export const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
export const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5 MB

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
]);

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".zip",
]);

/**
 * Ticket/chat attachments are validated by both extension and MIME type.
 * Browser-provided MIME is not trusted on its own: this prevents SVG/HTML or
 * arbitrary executable content from being served back from the Xdesk origin.
 */
export function isAllowedUploadFile(file: File) {
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) return false;
  if (!file.type || file.type === "application/octet-stream") return true;
  return ALLOWED_TYPES.has(file.type);
}


function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

/**
 * Validate common file signatures so a browser-supplied extension/MIME pair is
 * not enough to smuggle HTML/script/executable content under a safe filename.
 * This is not an antivirus scan; it is a lightweight format sanity check.
 */
export async function hasExpectedFileSignature(file: File) {
  const ext = path.extname(file.name).toLowerCase();
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (ext === ".png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (ext === ".jpg" || ext === ".jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (ext === ".gif") return new TextDecoder("ascii").decode(bytes.slice(0, 6)) === "GIF87a" || new TextDecoder("ascii").decode(bytes.slice(0, 6)) === "GIF89a";
  if (ext === ".webp") return new TextDecoder("ascii").decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder("ascii").decode(bytes.slice(8, 12)) === "WEBP";
  if (ext === ".pdf") return new TextDecoder("ascii").decode(bytes.slice(0, 5)) === "%PDF-";
  if ([".zip", ".docx", ".xlsx", ".pptx"].includes(ext)) {
    return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08]);
  }
  if ([".doc", ".xls", ".ppt"].includes(ext)) return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (ext === ".txt") return !bytes.includes(0);
  return false;
}

const PROFILE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const KNOWLEDGE_FILE_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const KNOWLEDGE_FILE_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".zip", ".png", ".jpg", ".jpeg", ".webp"
]);

export function isProfileImage(file: File) {
  return PROFILE_IMAGE_TYPES.has(file.type);
}

export function isKnowledgeFile(file: File) {
  const ext = path.extname(file.name).toLowerCase();
  return KNOWLEDGE_FILE_EXTENSIONS.has(ext) && (!file.type || KNOWLEDGE_FILE_TYPES.has(file.type));
}

async function ensureDir() {
  await mkdir(UPLOAD_ROOT, { recursive: true });
}

export async function saveUploadedFile(file: File) {
  await ensureDir();
  const ext = path.extname(file.name).slice(0, 20);
  const storedName = `${randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_ROOT, storedName), buffer);
  return {
    filename: file.name.slice(0, 200),
    storedName,
    mimeType: file.type || "application/octet-stream",
    size: buffer.length,
  };
}

export async function readStoredFile(storedName: string) {
  const safeName = path.basename(storedName);
  return readFile(path.join(UPLOAD_ROOT, safeName));
}

export async function deleteStoredFile(storedName: string) {
  const safeName = path.basename(storedName);
  try {
    await unlink(path.join(UPLOAD_ROOT, safeName));
  } catch {
    // ignore if already gone
  }
}
