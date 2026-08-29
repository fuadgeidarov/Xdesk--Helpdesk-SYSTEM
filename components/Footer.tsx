export function Footer({ portal = false }: { portal?: boolean }) {
  return (
    <footer className={portal ? "site-footer portal-footer" : "site-footer"}>
      <span><strong>Xdesk</strong> © Все права защищены.</span>
    </footer>
  );
}
