import type { Metadata } from "next"
import localFont from "next/font/local"

import "./globals.css"

const pretendard = localFont({
  src: [
    { path: "../public/fonts/Pretendard-Regular.otf", weight: "400" },
    { path: "../public/fonts/Pretendard-Medium.otf", weight: "500" },
    { path: "../public/fonts/Pretendard-Bold.otf", weight: "700" },
  ],
  variable: "--font-sans",
})

const fontMono = localFont({
  src: "../public/fonts/Pretendard-Regular.otf",
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
      className={`${pretendard.variable} ${fontMono.variable} dark font-sans antialiased`}
    >
      <body>{children}</body>
    </html>
  )
}
