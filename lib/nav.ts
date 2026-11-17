import {
  Cable,
  FolderKanban,
  Home,
  KeyRound,
  type LucideIcon,
} from "lucide-react";

/**
 * The whole navigation surface. Adding a destination here is all the sidebar
 * needs.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/connections", label: "Connections", icon: Cable },
  { href: "/api-token", label: "API token", icon: KeyRound },
];
