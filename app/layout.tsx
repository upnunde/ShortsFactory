import type { Metadata } from "next"
import { Geist_Mono, Noto_Sans_KR } from "next/font/google"

import "./globals.css"

const noto = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "쇼츠 스튜디오",
  description: "숏폼 검수 작업실",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="ko"
      suppressHydrationWarning
      data-theme="dark"
      className={`${noto.variable} ${fontMono.variable} dark font-sans antialiased`}
    >
      <body>{children}</body>
    </html>
  )
}
