import "./globals.css";

export const metadata = {
  title: "Expense Ledger",
  description: "Personal expense tracker",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
