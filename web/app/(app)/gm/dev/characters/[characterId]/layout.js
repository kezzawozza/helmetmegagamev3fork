import Link from "next/link";

// No AppHeader any more — the universal top bar carries no per-page title,
// so the name and avatar that used to sit in it are gone (the character's
// own name is already visible inside the panel's Identity tab). The two
// ways back stay, though: this page is reached from a CharacterLink anywhere
// in the app, so it needs them named rather than assumed. That is ordinary
// body content now, the same shape the zone editor's own "← All zones"
// already uses, rather than a header action.
export default function DevCharacterLayout({ children }) {
  return (
    <>
      <p className="flex flex-wrap items-center gap-3 px-4 pt-3">
        <Link href="/gm/dev?s=characters" className="menu-item">
          ← Characters
        </Link>
        <Link href="/gm/players" className="menu-item">
          ← Players
        </Link>
      </p>
      {children}
    </>
  );
}
