import type { ReactNode } from "react";

export const metadata = { title: "Rent", description: "เช่าชุดแบบไม่ต้องลุ้น" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body style={{ margin: 0, fontFamily: "system-ui, 'Noto Sans Thai', sans-serif", color: "#17181C", background: "#FFFFFF" }}>
        {children}
      </body>
    </html>
  );
}
