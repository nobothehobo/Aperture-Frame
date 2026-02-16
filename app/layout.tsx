import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Aperture Frame',
  description: 'iPhone-first photo border editor with maximum-quality exports.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
