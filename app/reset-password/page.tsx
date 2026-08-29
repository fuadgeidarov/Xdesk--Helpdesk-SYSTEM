import { ResetPasswordForm } from "@/components/ResetPasswordForm";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  return (
    <section className="auth-wrap">
      <div className="card auth-card">
        <h1>Новый пароль</h1>
        <p className="muted">Задайте новый пароль для своей учётной записи Xdesk.</p>
        <ResetPasswordForm token={params.token || ""} />
      </div>
    </section>
  );
}
