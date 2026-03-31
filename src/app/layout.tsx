import type { Metadata } from "next";
import {
  IBM_Plex_Mono,
  Newsreader,
  Plus_Jakarta_Sans,
} from "next/font/google";

import "./globals.css";

const sans = Plus_Jakarta_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const display = Newsreader({
  variable: "--font-editorial",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Creative Variant Sheet",
  description:
    "A standalone creative variant planning and image generation app for turning one product image into multiple testable ad directions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${sans.variable} ${display.variable} ${mono.variable} bg-background text-foreground antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
