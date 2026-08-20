import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const poppins = localFont({
  variable: "--font-sans",
  display: "swap",
  src: [
    { path: "../design-system/fonts/Poppins-Light.ttf", weight: "300", style: "normal" },
    { path: "../design-system/fonts/Poppins-LightItalic.ttf", weight: "300", style: "italic" },
    { path: "../design-system/fonts/Poppins-Regular.ttf", weight: "400", style: "normal" },
    { path: "../design-system/fonts/Poppins-Italic.ttf", weight: "400", style: "italic" },
    { path: "../design-system/fonts/Poppins-Medium.ttf", weight: "500", style: "normal" },
    { path: "../design-system/fonts/Poppins-MediumItalic.ttf", weight: "500", style: "italic" },
    { path: "../design-system/fonts/Poppins-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../design-system/fonts/Poppins-SemiBoldItalic.ttf", weight: "600", style: "italic" },
    { path: "../design-system/fonts/Poppins-Bold.ttf", weight: "700", style: "normal" },
    { path: "../design-system/fonts/Poppins-BoldItalic.ttf", weight: "700", style: "italic" },
  ],
});

// EB Garamond — accent-only headline font (optional per UI-SPEC; loaded now so
// `--font-accent` is available if a later plan places an accent headline).
const ebGaramond = localFont({
  variable: "--font-accent",
  display: "swap",
  src: [
    {
      path: "../design-system/fonts/EBGaramond-VariableFont_wght.ttf",
      weight: "400 800",
      style: "normal",
    },
    {
      path: "../design-system/fonts/EBGaramond-Italic-VariableFont_wght.ttf",
      weight: "400 800",
      style: "italic",
    },
  ],
});

export const metadata: Metadata = {
  title: "Safecypher Reporting",
  description:
    "Internal reporting and reconciliation dashboard for Safecypher's live card-verification deployment.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${ebGaramond.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
