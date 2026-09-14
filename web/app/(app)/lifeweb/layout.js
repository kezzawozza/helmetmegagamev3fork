import AppHeader from "@/app/components/AppHeader";

// Shared header drawn here (not inside the page) so it works whether the page is a server or client component. See components/AppHeader.js.
export default function LifewebLayout({ children }) {
  return (
    <>
      <AppHeader title="Lifeweb" />
      {children}
    </>
  );
}
