"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  GitBranch,
  Play,
  Settings,
  LogOut,
  Building2,
  ChevronDown,
  ChevronRight,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/store/auth";
import { orgsApi } from "@/lib/api";
import { initials } from "@/lib/helpers";
import type { Organization } from "@/types";
import { toast } from "sonner";

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/workflows", icon: GitBranch, label: "Workflows" },
  { href: "/runs", icon: Play, label: "Runs" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, currentOrg, setCurrentOrg, logout } = useAuthStore();
  const [orgsOpen, setOrgsOpen] = useState(false);

  const { data: orgs = [] } = useQuery({
    queryKey: ["orgs"],
    queryFn: orgsApi.list,
    enabled: !!user,
  });

  const handleOrgSelect = (org: Organization) => {
    setCurrentOrg(org);
    setOrgsOpen(false);
    router.push("/dashboard");
  };

  const handleLogout = () => {
    logout();
    toast.success("Signed out");
    router.push("/login");
  };

  return (
    <aside className="w-60 flex flex-col h-full border-r border-[hsl(var(--border))] bg-[hsl(var(--sidebar))] shrink-0">
      {/* Logo */}
      <Link href="/dashboard" className="px-4 flex items-center h-16 shrink-0">
        <Image
          src="/forge-logo.png"
          alt="Forge"
          width={48}
          height={48}
          className="h-12 w-12 object-contain rounded-md"
          priority
        />
      </Link>

      <Separator className="bg-[hsl(var(--border))]" />

      {/* Org switcher */}
      <div className="p-3">
        <button
          onClick={() => setOrgsOpen((o) => !o)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-[hsl(var(--sidebar-accent))] transition-colors text-left"
        >
          <Building2 className="w-4 h-4 text-[hsl(var(--muted-foreground))] shrink-0" />
          <span className="text-sm font-medium flex-1 truncate">
            {currentOrg?.name ?? "Select workspace"}
          </span>
          {orgsOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
          )}
        </button>

        <AnimatePresence>
          {orgsOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden mt-1"
            >
              <div className="pl-2 space-y-0.5">
                {orgs.map((org) => (
                  <button
                    key={org.id}
                    onClick={() => handleOrgSelect(org)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors text-left",
                      currentOrg?.id === org.id
                        ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"
                        : "hover:bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-foreground))]"
                    )}
                  >
                    <span className="truncate">{org.name}</span>
                    {org.plan !== "free" && (
                      <Badge variant="outline" className="text-[10px] py-0 px-1 ml-auto">
                        {org.plan}
                      </Badge>
                    )}
                  </button>
                ))}
                <Link
                  href="/orgs/new"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--foreground))] transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New workspace
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Separator className="bg-[hsl(var(--border))]" />

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link key={href} href={href}>
              <span
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all",
                  active
                    ? "bg-[hsl(var(--accent))] text-[hsl(var(--primary))]"
                    : "text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--foreground))]"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
                {active && (
                  <motion.div
                    layoutId="nav-indicator"
                    className="ml-auto w-1 h-4 bg-[hsl(var(--primary))] rounded-full"
                  />
                )}
              </span>
            </Link>
          );
        })}
      </nav>

      <Separator className="bg-[hsl(var(--border))]" />

      {/* User footer */}
      <div className="p-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-[hsl(var(--sidebar-accent))] transition-colors text-left"
          >
              <Avatar className="w-7 h-7 shrink-0">
                <AvatarFallback className="text-xs bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
                  {user ? initials(user.display_name) : "?"}
                </AvatarFallback>
              </Avatar>
              <div className="text-left flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user?.display_name}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{user?.email}</p>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-52">
            <DropdownMenuLabel>My account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <Settings className="w-4 h-4 mr-2" />Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-red-400">
              <LogOut className="w-4 h-4 mr-2" />Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
