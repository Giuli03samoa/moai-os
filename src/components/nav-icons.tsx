import { Activity, BarChart3, Bell, Bot, CheckSquare, CreditCard, Factory, FileText, LayoutDashboard, Megaphone, Package, PenTool, Plug, ReceiptText, Settings, ShoppingBag, Truck, type LucideIcon } from "lucide-react";
import type { NavIcon } from "./nav-items";

export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  overview: LayoutDashboard,
  assistant: Bot,
  alerts: Bell,
  tasks: CheckSquare,
  orders: ShoppingBag,
  payments: CreditCard,
  receipts: ReceiptText,
  invoices: FileText,
  shipping: Truck,
  products: Package,
  production: Factory,
  design: PenTool,
  marketing: Megaphone,
  analytics: BarChart3,
  integrations: Plug,
  sync: Activity,
  settings: Settings,
};
