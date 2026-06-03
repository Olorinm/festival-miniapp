import './globals.css'
import Analytics from './analytics'

export const metadata = {
  title: '赶场愉快 SIFF 2026',
  description: '电影节选片、挑场次和排片工具'
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
