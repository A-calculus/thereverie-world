export function Footer() {
  return (
    <footer className="border-t border-dream/20 bg-void/50 py-8 mt-auto z-10">
      <div className="container mx-auto px-4 flex flex-col md:flex-row justify-between items-center text-sm text-text-muted">
        <p>© 2026 REVERIE. Built for the Somnia Testnet.</p>
        <div className="flex gap-6 mt-4 md:mt-0">
          <a href="#" className="hover:text-aurora transition-colors">Twitter</a>
          <a href="#" className="hover:text-aurora transition-colors">GitHub</a>
          <a href="#" className="hover:text-aurora transition-colors">Docs</a>
        </div>
      </div>
    </footer>
  );
}
