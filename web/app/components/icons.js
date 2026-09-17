// The app's icon set: Lucide (https://lucide.dev), re-exported under the names the rest of the app already imports.
// 24×24 grid, round caps/joins, currentColor, 1.6 stroke (thinner than Lucide's default 2). Sizing is the caller's
// job. Nine glyphs with no Lucide equivalent stay hand-drawn at the bottom of the file.

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
  Mail,
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
  Backpack,
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
  Stamp,
  Unlock,
  Sprout,
  Sparkles,
  Grab,
  VenetianMask,
} from "lucide-react";

const STROKE = 1.6;

// Wraps a Lucide component so the house stroke is the default and any prop a call site passes still wins.
// Exported for web/lib/tagIcons.js, which needs the house stroke over its own ~40 tag-group glyphs. Those
// stay out of this file deliberately: they are a lookup table keyed by group slug, read by one module and
// imported by name nowhere, so re-exporting each would add forty dead names to the app's icon vocabulary.
export function lucide(Glyph, name) {
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
// The Store is where Tag Points get spent, so it reads as commerce rather than another list.
export const StoreIcon = lucide(ShoppingBag, "StoreIcon");
// A lidded box of records, not another sheet of paper — needs to read differently from Documents on the rail.
export const ArchiveIcon = lucide(Archive, "ArchiveIcon");
export const MapIcon = lucide(MapGlyph, "MapIcon");
export const SignOutIcon = lucide(LogOut, "SignOutIcon");
// The Dev-panel jump — a keep: the panel is where a GM rebuilds someone from the foundations up.
export const KeepIcon = lucide(Castle, "KeepIcon");
export const EyeIcon = lucide(Eye, "EyeIcon");
export const EditIcon = lucide(Pencil, "EditIcon");
// The mobile bottom bar's "More" affordance — see NavRail.js's MOBILE_PRIMARY.
export const MoreIcon = lucide(Ellipsis, "MoreIcon");
export const MailIcon = lucide(Mail, "MailIcon");
// The phone's Chat top bar: ≡ opens the places drawer, + opens the composer's tools menu.
export const MenuIcon = lucide(Menu, "MenuIcon");
export const PlusIcon = lucide(Plus, "PlusIcon");
// Chat's row action bar: pointing an instant camera at what somebody said, the web twin of the 📸 reaction.
export const CameraIcon = lucide(Camera, "CameraIcon");
// Chat's feed header: searching what was said, over the archive's trigram index (/api/feed/search).
export const SearchIcon = lucide(Search, "SearchIcon");

// Showing somebody out of a conversation or private room. A dismissal, not a deletion — TrashIcon says "thrown away".
export const CloseIcon = lucide(X, "CloseIcon");

// The uploaded-portrait queue on /gm/turns. Plain tick, not thumbs-up: the GM is signing off, not liking it.
export const CheckIcon = lucide(Check, "CheckIcon");
// The Chat page: a doorway you speak through. A plain speech bubble would read as MessageIcon (the GM's inbox).
export const PlayIcon = lucide(DoorOpen, "PlayIcon");
// Chat's mention chime. Two glyphs so the state reads at a glance; aria-pressed carries it for everyone else.
export const BellIcon = lucide(Bell, "BellIcon");
export const BellOffIcon = lucide(BellOff, "BellOffIcon");
// Web Push is ON for this browser. A ringing bell so the push toggle and chime toggle are told apart (CHAT.md §5a).
export const BellRingIcon = lucide(BellRing, "BellRingIcon");

// GM inbox chime mute toggle (NavRail.js). One name, two glyphs.
export function SpeakerIcon({ muted, ...props }) {
  const Glyph = muted ? VolumeX : Volume2;
  return <Glyph strokeWidth={STROKE} {...props} />;
}

// ── Dev Character Panel action bar (docs/systemdocs/DEV-PANEL.md) — one icon per microaction, 15px inside .icon-btn.

export const SkullIcon = lucide(Skull, "SkullIcon");
// Lift a curse — a cleansing sparkle, distinct from Revive's Ankh (that's a body coming back, not a penalty going away).
export const UncurseIcon = lucide(Sparkles, "UncurseIcon");
// Restore turn — counter-clockwise arrow, "give it back".
export const RestoreIcon = lucide(RotateCcw, "RestoreIcon");
// Spend turn — skip to the end, mirror of RestoreIcon.
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
// Intercept — a halt sign, not Loot's Hand or Bind's Link: laying in wait is neither taking nor tying (INTERCEPT.md).
export const InterceptIcon = lucide(OctagonMinus, "InterceptIcon");
// The Search VERB (docs/systemdocs/SEARCH.md) — a pack, because the verb is
// about what somebody is carrying. Named apart from SearchIcon above, which is
// Chat's magnifying glass over the archive and a wholly different act. A glass
// would have been wrong here anyway: 🔍 is the Discord inspect reaction and
// EyeIcon is "Look at", both of which answer what you can SEE on somebody
// rather than what is in their pockets.
export const SearchPersonIcon = lucide(Backpack, "SearchPersonIcon");
// Steal (docs/systemdocs/THEFT.md) — a hand closing on something. Deliberately
// close to Loot's open Hand, because it is the same gesture: the difference
// between the two verbs is who is watching, not what the fingers do.
export const StealIcon = lucide(Grab, "StealIcon");
// Pickpocket — a mask. Not a hand, because the other two theft verbs already
// own hands and a third would be unreadable at icon size; what this verb is
// actually about is not being recognised.
export const PickpocketIcon = lucide(VenetianMask, "PickpocketIcon");
// Attack — crossed blades, distinct from Harm's Wound (damage done) and Intercept's halt sign (waiting) (ATTACK.md).
export const AttackIcon = lucide(Swords, "AttackIcon");
// Free — the key that opens it.
export const KeyIcon = lucide(KeyRound, "KeyIcon");
// Break Restraints — the lock coming undone, distinct from Free's own KeyRound.
export const BreakRestraintsIcon = lucide(Unlock, "BreakRestraintsIcon");
// A bird in flight, for the Bird's letter.
export const BirdIcon = lucide(Bird, "BirdIcon");
// The Select trigger's open/close glyph.
export const ChevronDownIcon = lucide(ChevronDown, "ChevronDownIcon");
// The Journal's "pin to top" toggle. Not a star: that page already uses ★ for starred/[★] unstar.
export const PinIcon = lucide(Pin, "PinIcon");
export const SendIcon = lucide(Send, "SendIcon");
// Extract — a pick going into the ground, distinct from Craft's Hammer.
export const ExtractIcon = lucide(Pickaxe, "ExtractIcon");
// Torture — the brazier, distinct from Harm/Crucify's shared broken heart.
export const TortureIcon = lucide(Flame, "TortureIcon");
// A quill — the Write action. See docs/systemdocs/PAPERWORK.md.
export const QuillIcon = lucide(Feather, "QuillIcon");
// Brand — a stamp coming down, distinct from Torture's brazier.
export const BrandIcon = lucide(Stamp, "BrandIcon");
// Package — a banded crate.
export const CrateIcon = lucide(Package, "CrateIcon");
// Farm — a seedling, distinct from Extract's Pickaxe: sowing grows something rather than cutting it out.
export const FarmIcon = lucide(Sprout, "FarmIcon");

// ── Hand-drawn: no Lucide equivalent — same 24×24 grid, currentColor, round caps/joins, 1.6 stroke.

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

// Revive. An ankh, not a plain cross: the cross reads as "add" next to the heal icon.
export function AnkhIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M12 2.5c-2 0-3.5 1.6-3.5 3.7 0 1.8 1.2 3.2 2.3 4.3.5.5.7.9.7 1.5v9.5" />
      <path d="M12 2.5c2 0 3.5 1.6 3.5 3.7 0 1.8-1.2 3.2-2.3 4.3-.5.5-.7.9-.7 1.5" />
      <path d="M7 13.5h10" />
    </Glyph>
  );
}

// Butcher — a ham. Lucide has no cleaver; its knife (`Slice`) shares Pencil's diagonal. The joint reads as butchery at any size.
export const HamIcon = lucide(Ham, "HamIcon");

// Mutilate — shears, distinct from Butcher's ham: this takes a piece off somebody still standing.
export function ShearsIcon(props) {
  return (
    <Glyph {...props}>
      <circle cx="6" cy="18" r="2.6" />
      <circle cx="18" cy="18" r="2.6" />
      <path d="M7.7 16.1 18 4M16.3 16.1 6 4" />
    </Glyph>
  );
}

// Engrave — the same headstone as Bury, standing free of the ground with lettering: no ground line, three rules.
export function HeadstoneIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M6.5 21V8.5a5.5 5.5 0 0 1 11 0V21" />
      <path d="M9.5 11h5M9.5 14h5M9.5 17h3" />
    </Glyph>
  );
}

// Bury — a headstone in the ground; a cross alone would read as a plus sign at 16px.
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

// A hood pulled up over a bare face — the conceal toggle (PROXYING.md §5); deliberately nothing inside it.
export function HoodIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M12 3c-3.6 0-6 3.1-6 7 0 2.4 1 4.4 2.5 5.5" />
      <path d="M12 3c3.6 0 6 3.1 6 7 0 2.4-1 4.4-2.5 5.5" />
      <path d="M8.5 15.5 5 17.5V21h14v-3.5l-3.5-2" />
    </Glyph>
  );
}

// Lips, for the Kiss verb (KISS.md). Drawn rather than the 💋 emoji, to stay monochrome like the rest of the verb strip.
export function KissIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M12 9.5c1.2-2 3-2.8 4.8-2.4 2 .5 3.2 2.2 3.2 4 0 3.2-3.6 6.4-8 6.4S4 14.3 4 11.1c0-1.8 1.2-3.5 3.2-4C9 6.7 10.8 7.5 12 9.5Z" />
      <path d="M4.4 10.6c2.4.9 5 1.3 7.6 1.3s5.2-.4 7.6-1.3" />
    </Glyph>
  );
}
