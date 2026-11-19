import "@uploadrescue/ui/styles.css";
import type { ReactNode } from "react";

export const metadata = { title: "UploadRescue — Next.js example" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          maxWidth: 560,
          margin: "48px auto",
          padding: "0 16px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
