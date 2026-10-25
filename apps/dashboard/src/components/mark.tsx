"use client";

import type { Icon } from "@phosphor-icons/react";
import {
  AddressBookIcon,
  AlarmIcon,
  AtIcon,
  BookOpenIcon,
  EnvelopeOpenIcon,
  FactoryIcon,
  FingerprintIcon,
  HandHeartIcon,
  ProhibitIcon,
  BellIcon,
  BirdIcon,
  BrainIcon,
  BrowserIcon,
  CalendarCheckIcon,
  CalendarPlusIcon,
  ChatCircleIcon,
  ChatCircleTextIcon,
  ChatTextIcon,
  CircleIcon,
  CpuIcon,
  CurrencyDollarIcon,
  CursorClickIcon,
  EnvelopeIcon,
  EnvelopeSimpleIcon,
  FacebookLogoIcon,
  FileTextIcon,
  FlowArrowIcon,
  FunnelIcon,
  FunnelSimpleIcon,
  GoogleLogoIcon,
  HandshakeIcon,
  InstagramLogoIcon,
  LightbulbIcon,
  LightningIcon,
  LinkedinLogoIcon,
  ListIcon,
  MagnifyingGlassIcon,
  MegaphoneIcon,
  MicrophoneIcon,
  NewspaperIcon,
  NotePencilIcon,
  PackageIcon,
  PaperPlaneTiltIcon,
  PathIcon,
  PencilSimpleLineIcon,
  PhoneCallIcon,
  PhoneIcon,
  PlayIcon,
  QuestionIcon,
  RobotIcon,
  SealCheckIcon,
  ShareNetworkIcon,
  ShoppingCartIcon,
  SparkleIcon,
  StrategyIcon,
  TagIcon,
  TargetIcon,
  UserCheckIcon,
  UserFocusIcon,
  UserIcon,
  UserPlusIcon,
  UsersIcon,
  UsersThreeIcon,
  VideoCameraIcon,
  YoutubeLogoIcon,
} from "@phosphor-icons/react";

/**
 * Every catalogue object wears a mark: an icon in a soft tile of its own colour. The icon is the
 * object's served icon name when the catalogue has one (steps, channels), else its kind's glyph.
 * The colour is drawn from the object's id, so the same object wears the same mark on every page.
 */
const ICONS: Record<string, Icon> = {
  "address-book": AddressBookIcon,
  alarm: AlarmIcon,
  "book-open": BookOpenIcon,
  "envelope-open": EnvelopeOpenIcon,
  fingerprint: FingerprintIcon,
  "hand-heart": HandHeartIcon,
  prohibit: ProhibitIcon,
  tag: TagIcon,
  at: AtIcon,
  "at-sign": AtIcon,
  bell: BellIcon,
  bird: BirdIcon,
  browser: BrowserIcon,
  "calendar-check": CalendarCheckIcon,
  "calendar-plus": CalendarPlusIcon,
  "chat-circle-text": ChatCircleTextIcon,
  "currency-dollar": CurrencyDollarIcon,
  "cursor-click": CursorClickIcon,
  envelope: EnvelopeIcon,
  "envelope-simple": EnvelopeSimpleIcon,
  facebook: FacebookLogoIcon,
  "file-text": FileTextIcon,
  filter: FunnelSimpleIcon,
  handshake: HandshakeIcon,
  "help-circle": QuestionIcon,
  instagram: InstagramLogoIcon,
  lightbulb: LightbulbIcon,
  linkedin: LinkedinLogoIcon,
  list: ListIcon,
  "magnifying-glass": MagnifyingGlassIcon,
  mail: EnvelopeSimpleIcon,
  megaphone: MegaphoneIcon,
  "message-circle": ChatCircleIcon,
  "message-square": ChatTextIcon,
  mic: MicrophoneIcon,
  newspaper: NewspaperIcon,
  "note-pencil": NotePencilIcon,
  package: PackageIcon,
  "paper-plane-tilt": PaperPlaneTiltIcon,
  "pencil-simple-line": PencilSimpleLineIcon,
  phone: PhoneIcon,
  "phone-call": PhoneCallIcon,
  radar: TargetIcon,
  search: GoogleLogoIcon,
  "seal-check": SealCheckIcon,
  "share-2": ShareNetworkIcon,
  "shopping-cart": ShoppingCartIcon,
  sparkle: SparkleIcon,
  "user-check": UserCheckIcon,
  "user-focus": UserFocusIcon,
  "user-plus": UserPlusIcon,
  users: UsersIcon,
  "users-three": UsersThreeIcon,
  video: VideoCameraIcon,
  "video-camera": VideoCameraIcon,
  youtube: YoutubeLogoIcon,
};

/** The glyph of each kind of object that has no icon of its own. */
export const KIND_ICON = {
  outcome: FlowArrowIcon,
  leadTrack: PathIcon,
  trigger: LightningIcon,
  pipe: BirdIcon,
  funnel: FunnelIcon,
  path: PathIcon,
  play: PlayIcon,
  tactic: TagIcon,
  strategy: StrategyIcon,
  "script:rules": FlowArrowIcon,
  "script:ai": RobotIcon,
  "script:human": UserIcon,
  object: FileTextIcon,
  factory: FactoryIcon,
  audience: UsersThreeIcon,
  start: PlayIcon,
  point: BrainIcon,
  person: UserIcon,
  company: UsersIcon,
} as const satisfies Record<string, Icon>;

export type MarkKind = keyof typeof KIND_ICON;

const PALETTE = ["#0e9f86", "#6e5cf0", "#1d8be0", "#c7870a", "#e03a6a", "#5c9a1b", "#f5690b", "#0891b2", "#9333ea", "#db2777"];

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function markColor(id: string): string {
  return PALETTE[hashString(id) % PALETTE.length]!;
}

export function Mark({
  kind,
  id,
  icon,
  size = 20,
  quiet = false,
}: {
  kind: MarkKind;
  /** The object's id: it picks the colour. */
  id: string;
  /** The object's own icon name, when the catalogue serves one. */
  icon?: string | null;
  size?: number;
  /** A grey tile (for Start and other non-objects). */
  quiet?: boolean;
}) {
  const G: Icon = (icon ? ICONS[icon] : undefined) ?? KIND_ICON[kind] ?? CircleIcon;
  const color = markColor(`${kind}:${id}`);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center ${size <= 18 ? "rounded-[5px]" : "rounded-[8px]"} ${
        quiet ? "bg-[var(--bg-inset)] text-[var(--fg-2)] shadow-[inset_0_0_0_1px_var(--line)]" : ""
      }`}
      style={{ width: size, height: size, ...(quiet ? {} : { background: `${color}24`, color }) }}
    >
      <G size={Math.round(size * 0.62)} weight="duotone" />
    </span>
  );
}
