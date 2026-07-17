"use client";

import {
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  ImageIcon,
  LayoutDashboard,
  LogOut,
  Microscope,
  PenLine,
  TrendingUp,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { logout } from "@/features/auth/actions";

const NAV_ITEMS = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Knowledge Base", url: "/knowledge-base", icon: BookOpen },
  { title: "Trends", url: "/trends", icon: TrendingUp },
  { title: "Research", url: "/research", icon: Microscope },
  { title: "Planning", url: "/planning", icon: ClipboardList },
  { title: "Writing", url: "/writing", icon: PenLine },
  { title: "Review", url: "/review", icon: CheckCircle2 },
  { title: "Images", url: "/images", icon: ImageIcon },
  { title: "Approval", url: "/approval", icon: ClipboardCheck },
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "Profile", url: "/profile", icon: User },
];

export function AppSidebar({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold">
            L
          </div>
          <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">
            LinkedIn AI Studio
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    isActive={pathname === item.url}
                    tooltip={item.title}
                    render={<Link href={item.url} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg">
                <Avatar className="size-6">
                  <AvatarFallback>
                    {email.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate group-data-[collapsible=icon]:hidden">
                  {email}
                </span>
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => logout()}>
              <LogOut /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
