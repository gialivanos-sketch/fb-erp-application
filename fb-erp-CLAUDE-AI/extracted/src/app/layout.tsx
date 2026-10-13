import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import ClientLayout from "@/components/ClientLayout";

export const metadata: Metadata = {
  title: "F&B ERP - Food & Beverage Management System",
  description: "Enterprise-grade F&B ERP and Kitchen Intelligence Platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-100 text-slate-900 antialiased">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
