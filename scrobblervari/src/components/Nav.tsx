import { NavLink } from 'react-router-dom'
import { Disc3, BarChart2, Trash2 } from 'lucide-react'
import { cn } from '../lib/utils'

const links = [
  { to: '/vinyl', icon: Disc3,    label: 'CD / Vinyle' },
  { to: '/stats', icon: BarChart2, label: 'Stats'       },
  { to: '/clean', icon: Trash2,   label: 'Clean'        },
]

function NavItem({ to, icon: Icon, label }: typeof links[0]) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="hidden md:block">{label}</span>
    </NavLink>
  )
}

export function Sidebar() {
  return (
    <aside className="hidden sm:flex flex-col gap-1 w-14 md:w-48 shrink-0 border-r border-border px-2 py-4">
      {links.map(l => <NavItem key={l.to} {...l} />)}
    </aside>
  )
}

export function BottomNav() {
  return (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-10 border-t border-border bg-background/95 backdrop-blur-sm flex">
      {links.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors',
              isActive ? 'text-foreground' : 'text-muted-foreground',
            )
          }
        >
          <Icon className="h-5 w-5" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
