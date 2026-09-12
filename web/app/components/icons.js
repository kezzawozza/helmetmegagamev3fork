// The app's icon set: Lucide (https://lucide.dev), re-exported under the
// names the rest of the app already imports, so a call site never has to know
// which library is underneath. Every icon renders on Lucide's 24×24 grid with
// round caps and joins, in currentColor, at the 1.6 stroke the hand-drawn set
// used — thinner than Lucide's default 2, which reads heavy at the 15px the
// .icon-btn frame and the 20px the nav rail draw these at.
//
// Sizing is the caller's job, same as before: `width`/`height` props for a
// one-off (IconButton passes 15), CSS on `svg` for a family (.rail-item).
//
// Nine glyphs have no Lucide equivalent and stay hand-drawn at the bottom of
// the file, redrawn to Lucide's conventions so they sit in the same weight.

import {
  User,
  Users,
  ScrollText,
  Check,
  ShieldCheck,
  Coins,
  Scale,
  MessageSquare,
  CodeXml,
  FileText,
  CircleHelp,
  Star,
  ShoppingBag,
  Archive,
  Map as MapGlyph,
  LogOut,
  Castle,
  Eye,
  Pencil,
  Volume2,
  VolumeX,
  Ellipsis,
  Skull,
  RotateCcw,
  SkipForward,
  HeartCrack,
  Bandage,
  Soup,
  Ham,
  RefreshCw,
  Trash2,
  Hammer,
  Hexagon,
  ArrowLeftRight,
  Hand,
  Link,
  KeyRound,
  Bird,
  ChevronDown,
  Pin,
  Send,
  Pickaxe,
  Flame,
  Feather,
  Package,
  DoorOpen,
  Bell,
  BellRing,
  BellOff,
  Camera,
  Search,
  OctagonMinus,
  Swords,
  X,
  Menu,
  Plus,
} from "lucide-react";

const STROKE = 1.6;

// Wraps a Lucide component so the house stroke is the default and any prop a
// call site passes (width, height, className, aria-*) still wins.
function lucide(Glyph, name) {
  function Icon(props) {
    return <Glyph strokeWidth={STROKE} {...props} />;
  }
  Icon.displayName = name;
  return Icon;
}

// ── Nav rail (NavRail.js) ────────────────────────────────────────────────────

export const CharacterIcon = lucide(User, "CharacterIcon");
export const PlayersIcon = lucide(Users, "PlayersIcon");
export const AuditIcon = lucide(ScrollText, "AuditIcon");
export const FactionIcon = lucide(ShieldCheck, "FactionIcon");
export const ScaleIcon = lucide(Scale, "ScaleIcon");
export const EconomyIcon = lucide(Coins, "EconomyIcon");
export const MessageIcon = lucide(MessageSquare, "MessageIcon");
export const DevIcon = lucide(CodeXml, "DevIcon");
export const DocumentsIcon = lucide(FileText, "DocumentsIcon");
// The Handbook rail tab.
export const HelpIcon = lucide(CircleHelp, "HelpIcon");
export const NotesIcon = lucide(Star, "NotesIcon");
// The Store is where Tag Points get spent, so it reads as commerce rather
// than another list.
export const StoreIcon = lucide(ShoppingBag, "StoreIcon");
// A lidded box of records, not another sheet of paper — the Archive is the
// game's kept history, and needs to read as a different kind of thing from
// Documents (reference prose) sitting next to it on the rail.
export const ArchiveIcon = lucide(Archive, "ArchiveIcon");
export const MapIcon = lucide(MapGlyph, "MapIcon");
export const SignOutIcon = lucide(LogOut, "SignOutIcon");
// The Dev-panel jump — a keep: the panel is where a GM rebuilds someone from
// the foundations up.
export const KeepIcon = lucide(Castle, "KeepIcon");
export const EyeIcon = lucide(Eye, "EyeIcon");
export const EditIcon = lucide(Pencil, "EditIcon");
// The mobile bottom bar's "More" affordance — see NavRail.js's MOBILE_PRIMARY.
export const MoreIcon = lucide(Ellipsis, "MoreIcon");
// The phone's Chat top bar: ≡ opens the places drawer, + opens the composer's
// tools menu (Chat's ChatHead.js and Feed.js).
export const MenuIcon = lucide(Menu, "MenuIcon");
export const PlusIcon = lucide(Plus, "PlusIcon");
// Chat's row action bar: pointing an instant camera at what somebody said,
// the web twin of the 📸 reaction.
export const CameraIcon = lucide(Camera, "CameraIcon");
// Chat's feed header: searching what was said, over the archive's trigram
// index (/api/feed/search).
export const SearchIcon = lucide(Search, "SearchIcon");

// Showing somebody out of a conversation or a private room
// (web/app/(app)/chat/MembersStrip.js). A dismissal, not a deletion:
// TrashIcon says the person is being thrown away, which is the wrong
// sentence for "they may not come in here any more".
export const CloseIcon = lucide(X, "CloseIcon");

// The uploaded-portrait queue on /gm/turns: this face is fine, keep it. Paired
// with CloseIcon for the other answer, and a plain tick rather than a
// thumbs-up because the GM is signing something off, not liking it.
export const CheckIcon = lucide(Check, "CheckIcon");
// The Chat page: a doorway you speak through. A plain speech bubble would have
// read as MessageIcon at rail size, which is the GM's inbox.
export const PlayIcon = lucide(DoorOpen, "PlayIcon");
// Chat's mention chime, at the foot of the places column. Two glyphs
// rather than one so the state reads at a glance; aria-pressed carries it for
// everyone else.
export const BellIcon = lucide(Bell, "BellIcon");
export const BellOffIcon = lucide(BellOff, "BellOffIcon");
// Web Push is ON for this browser. A ringing bell rather than a second plain
// one, so the push toggle and the chime toggle beside it are told apart at a
// glance (CHAT.md §5a).
export const BellRingIcon = lucide(BellRing, "BellRingIcon");

// GM inbox chime mute toggle (NavRail.js). One name, two glyphs.
export function SpeakerIcon({ muted, ...props }) {
  const Glyph = muted ? VolumeX : Volume2;
  return <Glyph strokeWidth={STROKE} {...props} />;
}

// ── Dev Character Panel action bar (docs/systemdocs/DEV-PANEL.md) ──────────
// One icon per microaction, at 15px inside .icon-btn.

export const SkullIcon = lucide(Skull, "SkullIcon");
// Restore turn — a counter-clockwise arrow, the universal "give it back".
export const RestoreIcon = lucide(RotateCcw, "RestoreIcon");
// Spend turn — skip to the end, the mirror of RestoreIcon.
export const SkipIcon = lucide(SkipForward, "SkipIcon");
// Inflict wound.
export const WoundIcon = lucide(HeartCrack, "WoundIcon");
// Heal all.
export const BandageIcon = lucide(Bandage, "BandageIcon");
// Feed — a bowl, not cutlery: cutlery at 15px is two indistinct strokes.
export const MealIcon = lucide(Soup, "MealIcon");
// Re-push this character's Discord state.
export const SyncIcon = lucide(RefreshCw, "SyncIcon");
export const TrashIcon = lucide(Trash2, "TrashIcon");
// Craft — the recipe door on the action grid (actionRegistry.js).
export const HammerIcon = lucide(Hammer, "HammerIcon");
// Transfer Resources — the filled ⬢ of the Resources glyph.
export function ResourcesIcon(props) {
  return <Hexagon strokeWidth={STROKE} fill="currentColor" {...props} />;
}

// ── The player Actions grid (ActionGrid.js) ─────────────────────────────────

// Transfer Tag — a thing passed one way or the other.
export const HandOffIcon = lucide(ArrowLeftRight, "HandOffIcon");
// Loot — an open hand.
export const LootIcon = lucide(Hand, "LootIcon");
// Bind — a chain link.
export const ShackleIcon = lucide(Link, "ShackleIcon");
// Intercept — a halt sign. Not the Hand that Loot already wears, and not the
// Link that Bind wears: laying in wait is neither taking nor tying, it is
// standing in somebody's way (docs/systemdocs/INTERCEPT.md).
export const InterceptIcon = lucide(OctagonMinus, "InterceptIcon");
// Attack — crossed blades. Not the Wound that Harm wears (that is damage
// already done) and not the halt sign Intercept wears (that is waiting for
// somebody): this is the moment two people are locked together
// (docs/systemdocs/ATTACK.md).
export const AttackIcon = lucide(Swords, "AttackIcon");
// Free — the key that opens it.
export const KeyIcon = lucide(KeyRound, "KeyIcon");
// A bird in flight, for the Bird's letter.
export const BirdIcon = lucide(Bird, "BirdIcon");
// The Select trigger's open/close glyph.
export const ChevronDownIcon = lucide(ChevronDown, "ChevronDownIcon");
// The Journal's "pin to top" toggle. Deliberately not a star: that page
// already uses ★ for a starred message, and the Starred tab's [★] means
// "unstar/delete" — a star meaning "pinned" on one tab and "delete" on the
// other would overload the same glyph two ways on one page.
export const PinIcon = lucide(Pin, "PinIcon");
export const SendIcon = lucide(Send, "SendIcon");
// Extract — a pick going into the ground. Distinct from the Hammer used by
// Craft, which a plain axe would not have been.
export const ExtractIcon = lucide(Pickaxe, "ExtractIcon");
// Torture — the brazier. Distinct from the broken heart Harm and Crucify
// share, so the three cruelties do not read as one button.
export const TortureIcon = lucide(Flame, "TortureIcon");
// A quill — the Write action. See docs/systemdocs/PAPERWORK.md.
export const QuillIcon = lucide(Feather, "QuillIcon");
// Package — a banded crate.
export const CrateIcon = lucide(Package, "CrateIcon");

// ── Hand-drawn: no Lucide equivalent ────────────────────────────────────────
// Same 24×24 grid, currentColor, round caps and joins, 1.6 stroke, so they
// sit at the same weight as the Lucide glyphs around them.

function Glyph({ children, ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

// The Tower — a drop of blood with a flame's shoulders.
export function LifewebIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M12 3.5c3.2 4 5.5 7.3 5.5 10.3a5.5 5.5 0 1 1-11 0c0-3 2.3-6.3 5.5-10.3z" />
      <path d="M9.7 15.5c0 1.4 1 2.3 2.3 2.3" />
    </Glyph>
  );
}

// Revive. An ankh rather than a plain cross: the cross reads as "add" next to
// the heal icon, and this button is specifically "bring them back".
export function AnkhIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M12 2.5c-2 0-3.5 1.6-3.5 3.7 0 1.8 1.2 3.2 2.3 4.3.5.5.7.9.7 1.5v9.5" />
      <path d="M12 2.5c2 0 3.5 1.6 3.5 3.7 0 1.8-1.2 3.2-2.3 4.3-.5.5-.7.9-.7 1.5" />
      <path d="M7 13.5h10" />
    </Glyph>
  );
}

// Butcher — a ham. Lucide has no cleaver, and the hand-drawn one it replaces
// proved why that is hard: an outlined rectangle at 16px is a saucepan, not a
// blade. Lucide's own knife (`Slice`) is legible but is the same diagonal as
// the Pencil. The joint reads as butchery at any size and can't be mistaken
// for anything else in the strip.
export const HamIcon = lucide(Ham, "HamIcon");

// Mutilate — shears. It sits next to Butcher's ham in the grid and has to
// read as a different verb at 16px: Butcher takes a whole body and gives you
// meat, this takes a piece off somebody still standing.
export function ShearsIcon(props) {
  return (
    <Glyph {...props}>
      <circle cx="6" cy="18" r="2.6" />
      <circle cx="18" cy="18" r="2.6" />
      <path d="M7.7 16.1 18 4M16.3 16.1 6 4" />
    </Glyph>
  );
}

// Engrave — the same headstone as Bury, but standing free of the ground and
// carrying lettering. The two sit side by side in the action grid, so what
// separates them has to be visible at 16px: no ground line, three rules.
export function HeadstoneIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M6.5 21V8.5a5.5 5.5 0 0 1 11 0V21" />
      <path d="M9.5 11h5M9.5 14h5M9.5 17h3" />
    </Glyph>
  );
}

// Bury — a headstone in the ground. The rounded top and the ground line read
// as a grave at 16px, where a cross alone would read as a plus sign.
export function GraveIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M7 20V9a5 5 0 0 1 10 0v11" />
      <path d="M12 8v6M9.5 10.5h5" />
      <path d="M3.5 20h17" />
    </Glyph>
  );
}

// A folded letter closed with a blob of wax — the Seal action.
export function SealIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M3.5 6.5h17v12h-17z" />
      <path d="M3.5 6.5L12 13l8.5-6.5" />
      <circle cx="12" cy="15.5" r="2.75" />
    </Glyph>
  );
}

// A hood pulled up over a bare face — the conceal toggle (PROXYING.md §5). The
// cowl's peak and the shoulders are what read at 16px; there is deliberately
// nothing inside it, because that is the whole point of the thing.
export function HoodIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M12 3c-3.6 0-6 3.1-6 7 0 2.4 1 4.4 2.5 5.5" />
      <path d="M12 3c3.6 0 6 3.1 6 7 0 2.4-1 4.4-2.5 5.5" />
      <path d="M8.5 15.5 5 17.5V21h14v-3.5l-3.5-2" />
    </Glyph>
  );
}

// Lips, for the Kiss verb (docs/systemdocs/KISS.md). Bascinet asked for the
// lips emoji; 💋 is the only colour glyph that would ever have sat in the verb
// strip, which is otherwise a row of monochrome line icons that take the
// theme's colour — so it is drawn instead of pasted. The cupid's bow on top
// and the fuller lower lip are what read at 16px; the centre line is what
// stops it looking like a leaf.
export function KissIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M12 9.5c1.2-2 3-2.8 4.8-2.4 2 .5 3.2 2.2 3.2 4 0 3.2-3.6 6.4-8 6.4S4 14.3 4 11.1c0-1.8 1.2-3.5 3.2-4C9 6.7 10.8 7.5 12 9.5Z" />
      <path d="M4.4 10.6c2.4.9 5 1.3 7.6 1.3s5.2-.4 7.6-1.3" />
    </Glyph>
  );
}
