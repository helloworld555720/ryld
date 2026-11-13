import { Cable, Home, type LucideIcon } from "lucide-react";

/**
 * The whole navigation surface. The product deliberately has two destinations
 * for now; adding one here is all the sidebar needs.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/connections", label: "Connections", icon: Cable },
];
