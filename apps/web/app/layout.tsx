import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'RoomSell AI · Room studio',
  description: 'Measured room planning with furniture locks and deterministic rearrangement.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
