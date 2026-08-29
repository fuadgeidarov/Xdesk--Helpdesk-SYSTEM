import Link from "next/link";

type Props = {
  size?: "sm" | "md" | "lg";
  href?: string | null;
  withTagline?: boolean;
  withCompany?: boolean;
};

const sizes = {
  sm: "logo logo-sm",
  md: "logo",
  lg: "logo logo-lg",
};

export function Logo({ size = "md", href = "/", withTagline = false, withCompany = false }: Props) {
  const content = (
    <span className={sizes[size]}>
      <span className="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M12 2.6 20 6v6.1c0 4.7-3.3 7.9-8 9.3-4.7-1.4-8-4.6-8-9.3V6l8-3.4Z"
            fill="currentColor"
            opacity="0.16"
          />
          <path
            d="M12 2.6 20 6v6.1c0 4.7-3.3 7.9-8 9.3-4.7-1.4-8-4.6-8-9.3V6l8-3.4Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="m9.2 8.6 5.6 6.8M14.8 8.6l-5.6 6.8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="logo-copy">
        <span className="logo-word">
          X<span className="logo-word-accent">desk</span>
        </span>
        {withTagline && <span className="logo-tagline">HELP DESK PORTAL</span>}
        {withCompany && <span className="logo-company">Your Company</span>}
      </span>
    </span>
  );

  if (!href) return content;

  return (
    <Link href={href} className="logo-link" aria-label="Xdesk — IT Helpdesk">
      {content}
    </Link>
  );
}
