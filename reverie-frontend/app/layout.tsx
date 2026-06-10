import type { Metadata } from 'next';
import '@xyflow/react/dist/style.css';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: 'REVERIE | Autonomous World Engine',
  description: 'Build worlds that dream. Autonomous on-chain systems on Somnia testnet.',
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-void text-text-primary antialiased min-h-screen flex flex-col font-sans">
        <Providers>
          <div className="fixed inset-0 bg-aurora z-0 pointer-events-none opacity-50" />
          {children}
        </Providers>
      </body>
    </html>
  );
}
