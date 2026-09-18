// Which glyph a tag wears. One icon per TagGroup, falling back to one per
// Tag.category, so every tag draws something and a tag in no group still says
// what kind of thing it is.
//
// This is the finer half of a two-level code: COLOUR answers "what category"
// (the --tag-* tokens in globals.css, one per category, applied as the chip's
// left rule), and the ICON answers "what sort of thing within it". Before the
// two were split, colour came from TagGroup.color — a freeform hex per group —
// so a sheet showed forty-odd stripes with no key and the same hue could mean
// two unrelated things. Keep the levels apart: a group must never get its own
// colour, and the icon must never be the only thing distinguishing two
// categories.
//
// Slugs match docs/taggroups.yaml. A group added there without a line here is
// not an error — it falls through to its category's glyph — but it is a
// missed chance to say something, so add one.

import {
  Church,
  Pill,
  Drama,
  Ban,
  Dog,
  VenetianMask,
  Crown,
  MapPin,
  HeartPulse,
  Utensils,
  ChevronsUp,
  ChevronsDown,
  Wine,
  Wrench,
  Shield,
  Sparkles,
  Bone,
  Biohazard,
  Thermometer,
  Brain,
  Sprout,
  Landmark,
  PawPrint,
  House,
  Sword,
  FlaskConical,
  Stethoscope,
  Ghost,
  GraduationCap,
  Cross,
  Warehouse,
  Fingerprint,
  Heart,
  Users,
  Ham,
  Skull,
  Swords,
  KeyRound,
  Hammer,
  Soup,
  Pickaxe,
  Package,
  FileText,
  HeartCrack,
  Bandage,
  Scissors,
} from "lucide-react";

import { lucide } from "../app/components/icons";

const glyph = (G, name) => lucide(G, name);

// Keyed by TagGroup.slug.
export const TAG_GROUP_ICONS = {
  // General — who somebody is. The blue family.
  "general-traits": glyph(Fingerprint, "TraitsIcon"),
  "general-social": glyph(Users, "SocialIcon"),
  "general-beliefs": glyph(Church, "BeliefsIcon"),
  "general-addictions": glyph(Pill, "AddictionsIcon"),
  "general-personality": glyph(Drama, "PersonalityIcon"),
  "general-restrictions": glyph(Ban, "RestrictionsIcon"),
  "general-interests": glyph(Heart, "InterestsIcon"),
  "general-cerberon": glyph(Dog, "CerberonIcon"),
  "general-brigand": glyph(VenetianMask, "BrigandIcon"),
  "general-court": glyph(Crown, "CourtIcon"),
  "general-location": glyph(MapPin, "OriginIcon"),

  // Status — how somebody is right now. Amber.
  "status-health": glyph(HeartPulse, "StatusHealthIcon"),
  "status-food": glyph(Utensils, "HungerIcon"),
  "status-buffs": glyph(ChevronsUp, "BuffIcon"),
  "status-debuffs": glyph(ChevronsDown, "DebuffIcon"),

  // Items — what somebody is carrying. Teal, and the category where the icon
  // earns its keep: eleven groups a player sorts a full pack by.
  "items-food": glyph(Ham, "FoodIcon"),
  "items-seeds": glyph(Sprout, "SeedsIcon"),
  "items-drink": glyph(Wine, "DrinkIcon"),
  "items-gear": glyph(Wrench, "GearIcon"),
  "items-armor": glyph(Shield, "ArmorIcon"),
  "items-headgear": glyph(Crown, "HeadgearIcon"),
  "items-special": glyph(Sparkles, "SpecialItemIcon"),
  "items-keys": glyph(KeyRound, "ItemKeyIcon"),
  "items-weapons": glyph(Swords, "WeaponIcon"),
  "items-corpse": glyph(Skull, "CorpseIcon"),
  "items-remains": glyph(Bone, "RemainsIcon"),
  "items-paper": glyph(FileText, "PaperIcon"),

  // Health — what is wrong, split by the kind of medicine it needs (TAGS.md
  // §5c), which is exactly what the glyph should say.
  "health-wounds": glyph(HeartCrack, "WoundsIcon"),
  "health-infection": glyph(Biohazard, "InfectionIcon"),
  "health-illness": glyph(Thermometer, "IllnessIcon"),
  "health-maiming": glyph(Scissors, "MaimingIcon"),
  "health-mind": glyph(Brain, "MindIcon"),
  "health-minor": glyph(Bandage, "MinorIcon"),
  "health-recovery": glyph(Sprout, "RecoveryIcon"),

  // Assets — what somebody owns rather than carries. Stone.
  "assets-property": glyph(Landmark, "PropertyIcon"),
  "assets-companions": glyph(PawPrint, "CompanionIcon"),
  "assets-structures": glyph(House, "StructureIcon"),

  // Skills — what somebody can do. Green.
  "skills-work": glyph(Pickaxe, "WorkIcon"),
  "skills-fighting": glyph(Sword, "FightingIcon"),
  "skills-crafting": glyph(Hammer, "CraftingIcon"),
  "skills-brewing": glyph(FlaskConical, "BrewingIcon"),
  "skills-cooking": glyph(Soup, "CookingIcon"),
  "skills-medical": glyph(Stethoscope, "MedicalIcon"),

  demoness: glyph(Ghost, "DemonessIcon"),
};

// Keyed by a lower-cased Tag.category, for a tag in no group at all.
export const TAG_CATEGORY_ICONS = {
  general: glyph(Fingerprint, "GeneralIcon"),
  skills: glyph(GraduationCap, "SkillIcon"),
  status: glyph(HeartPulse, "StatusIcon"),
  health: glyph(Cross, "HealthIcon"),
  items: glyph(Package, "ItemIcon"),
  assets: glyph(Warehouse, "AssetIcon"),
  demoness: glyph(Ghost, "DemonessCategoryIcon"),
};

// Resolving a tag to one of these is web/app/components/TagIcon.js's job, not
// a helper's here — see its header for why a function returning a component
// cannot be used from render in this repo.
