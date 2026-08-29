import nodemailer from "nodemailer";

type SmtpProvider = "gmail" | "mailru" | "custom";

function readPort(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function provider(): SmtpProvider {
  const raw = process.env.SMTP_PROVIDER?.trim().toLowerCase();
  if (raw === "gmail" || raw === "mailru") return raw;
  return "custom";
}

function smtpSettings() {
  const selected = provider();
  const allowAnonymous = process.env.SMTP_ALLOW_ANONYMOUS === "true";
  const user = process.env.SMTP_USER?.trim();
  const rawPassword = process.env.SMTP_PASSWORD;
  // Google displays App Passwords in four groups for readability. Accept a
  // pasted value with spaces as well as the canonical 16-character form.
  const password = selected === "gmail" ? rawPassword?.replace(/\s+/g, "") : rawPassword;

  let host = process.env.SMTP_HOST?.trim();
  let secure = process.env.SMTP_SECURE === "true";
  let portFallback = secure ? 465 : 587;

  if (selected === "gmail") {
    host ||= "smtp.gmail.com";
    // Gmail supports STARTTLS:587 and implicit TLS:465. Prefer 465 for a
    // predictable Docker setup unless the administrator overrides it.
    if (!process.env.SMTP_PORT && !process.env.SMTP_SECURE) secure = true;
    portFallback = secure ? 465 : 587;
  } else if (selected === "mailru") {
    host ||= "smtp.mail.ru";
    // Mail.ru recommends SSL/TLS on 465 for authenticated SMTP.
    if (!process.env.SMTP_PORT && !process.env.SMTP_SECURE) secure = true;
    portFallback = secure ? 465 : 587;
  }

  const port = readPort(process.env.SMTP_PORT, portFallback);
  const from = process.env.SMTP_FROM?.trim() || (user ? `Xdesk <${user}>` : "");

  return { selected, host, port, secure, allowAnonymous, user, password, from };
}

export function mailConfigured() {
  const cfg = smtpSettings();
  return Boolean(
    cfg.host &&
    cfg.from &&
    (cfg.allowAnonymous || (cfg.user && cfg.password)),
  );
}

function transporter() {
  const cfg = smtpSettings();
  if (!cfg.host) throw new Error("SMTP host is not configured");
  if (!cfg.allowAnonymous && (!cfg.user || !cfg.password)) {
    throw new Error("SMTP credentials are not configured");
  }

  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.allowAnonymous
      ? undefined
      : {
          user: cfg.user,
          pass: cfg.password,
        },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    tls: process.env.SMTP_TLS_REJECT_UNAUTHORIZED === "false"
      ? { rejectUnauthorized: false }
      : undefined,
  });
}

export async function verifyMailTransport() {
  if (!mailConfigured()) {
    return { ok: false as const, reason: "SMTP is not configured" };
  }
  try {
    await transporter().verify();
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : "SMTP verification failed",
    };
  }
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string;
  resetUrl: string;
  expiresMinutes: number;
}) {
  if (!mailConfigured()) throw new Error("SMTP is not configured");

  const cfg = smtpSettings();
  const tx = transporter();
  await tx.sendMail({
    from: cfg.from,
    to: opts.to,
    subject: "Xdesk — восстановление пароля",
    text: [
      `Здравствуйте, ${opts.name}.`,
      "",
      "Для Xdesk был запрошен сброс пароля.",
      `Откройте ссылку и задайте новый пароль: ${opts.resetUrl}`,
      "",
      `Ссылка действительна ${opts.expiresMinutes} минут и может быть использована только один раз.`,
      "Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.55;color:#17231f;max-width:620px">
        <h2 style="margin:0 0 16px">Восстановление пароля Xdesk</h2>
        <p>Здравствуйте, ${escapeHtml(opts.name)}.</p>
        <p>Для вашей учётной записи Xdesk был запрошен сброс пароля.</p>
        <p><a href="${escapeHtml(opts.resetUrl)}" style="display:inline-block;padding:12px 18px;background:#0f766e;color:white;text-decoration:none;border-radius:10px;font-weight:700">Задать новый пароль</a></p>
        <p style="color:#64746d">Ссылка действительна ${opts.expiresMinutes} минут и используется только один раз.</p>
        <p style="color:#64746d">Если вы не запрашивали сброс пароля, проигнорируйте это письмо.</p>
      </div>
    `,
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] || char);
}
