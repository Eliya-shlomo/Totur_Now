import { NavLink } from '@mantine/core';
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';

/**
 * Desktop and tablet navigation. Rendered inside AppShell.Navbar.
 *
 * Active state comes from the router rather than local state, so a deep link lands
 * with the correct item highlighted.
 */
export default function SidebarNav({ items, onNavigate }) {
  const { pathname } = useLocation();

  return (
    <>
      {items.map(({ to, label, icon: Icon, end }) => {
        const active = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);

        return (
          <NavLink
            key={to}
            component={RouterNavLink}
            to={to}
            end={end}
            label={label}
            leftSection={<Icon size={20} stroke={1.5} />}
            active={active}
            onClick={onNavigate}
          />
        );
      })}
    </>
  );
}
