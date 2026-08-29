import Link from "next/link";
import { Logo } from "@/components/Logo";
import { HomeFeed } from "@/components/HomeFeed";
import { LandingAuthCard } from "@/components/LandingAuthCard";
import { getSessionUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getSessionUser();
  return (
    <section className="landing-split">
      <div className="landing-info-panel">
        <div className="landing-info-top"><Logo size="sm" href="/" withTagline withCompany /><span className="pill">Портал заявок IT-поддержки</span></div>
        <div className="landing-info-copy">
          <h1>Поддержка в один клик</h1>
          <p>Создайте обращение напрямую — без лишней бюрократии. Специалист возьмёт задачу в работу, ответит в чате заявки и закроет её с оценкой качества.</p>
          <div className="hero-facts">
            <div><strong>24/7</strong><span>приём обращений</span></div>
            <div><strong>1 мин</strong><span>на подачу заявки</span></div>
            <div><strong>Чат</strong><span>онлайн-переписка с IT</span></div>
          </div>
          <HomeFeed />
        </div>
      </div>
      <div className="landing-auth-panel">
        <LandingAuthCard user={user} />
        {!user && <Link href="/tickets/new" className="landing-mobile-guest">Создать заявку</Link>}
      </div>
    </section>
  );
}
