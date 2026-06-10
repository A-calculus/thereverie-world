import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-10 flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 flex flex-col pt-16">
        {children}
      </main>
      <Footer />
    </div>
  );
}
