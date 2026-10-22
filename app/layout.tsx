import type { ReactNode } from 'react';
import { IBM_Plex_Mono, IBM_Plex_Sans, Silkscreen } from 'next/font/google';
import './globals.css';

const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-sans', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });
const pixel = Silkscreen({ subsets: ['latin'], weight: ['400'], variable: '--font-pixel', display: 'swap' });

export const metadata = {
  title: 'Constructinator',
  description: 'Build one new psyche from up to six chat exports and render it as a Soul Pack.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${pixel.variable}`}>
      <body>{children}</body>
    </html>
  );
}
