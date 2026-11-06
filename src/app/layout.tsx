import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Сибирская математическая олимпиада",
  description: "Личный кабинет участников и организаторов СМО",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body className="min-h-screen antialiased">{children}</body></html>;
}
