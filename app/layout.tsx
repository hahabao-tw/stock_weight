import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '加權指數權值表',
  description: '台股前 100 大權值股漲跌停貢獻點數查詢工具',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
