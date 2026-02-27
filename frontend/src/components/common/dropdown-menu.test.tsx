import { render, screen, fireEvent } from '@testing-library/react';
import { DropdownMenu, type MenuItem } from './dropdown-menu';

function makeItems(overrides?: { onAction?: () => void; onToggle?: () => void }): MenuItem[] {
  return [
    { kind: 'action', label: 'Import', onAction: overrides?.onAction ?? vi.fn() },
    { kind: 'action', label: 'Export', onAction: overrides?.onAction ?? vi.fn() },
    { kind: 'separator' },
    { kind: 'toggle', label: 'Dark mode', checked: false, onToggle: overrides?.onToggle ?? vi.fn() },
  ];
}

function renderMenu(items?: MenuItem[]) {
  return render(
    <DropdownMenu
      items={items ?? makeItems()}
      triggerLabel="Menu"
      triggerContent="☰"
    />,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
}

describe('DropdownMenu', () => {
  describe('rendering', () => {
    it('renders the trigger button', () => {
      renderMenu();
      expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
    });

    it('does not show menu initially', () => {
      renderMenu();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('trigger has aria-expanded=false initially', () => {
      renderMenu();
      expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('open/close', () => {
    it('opens on trigger click', () => {
      renderMenu();
      openMenu();
      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('closes on second trigger click', () => {
      renderMenu();
      openMenu();
      fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes on Escape key', () => {
      renderMenu();
      openMenu();
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('returns focus to trigger on Escape', () => {
      renderMenu();
      openMenu();
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      expect(screen.getByRole('button', { name: 'Menu' })).toHaveFocus();
    });

    it('closes on click outside', () => {
      renderMenu();
      openMenu();
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('opens with ArrowDown on trigger and focuses first item', () => {
      renderMenu();
      fireEvent.keyDown(screen.getByRole('button', { name: 'Menu' }), { key: 'ArrowDown' });
      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
    });
  });

  describe('action items', () => {
    it('calls onAction and closes menu on click', () => {
      const onAction = vi.fn();
      const items: MenuItem[] = [
        { kind: 'action', label: 'Do thing', onAction },
      ];
      renderMenu(items);
      openMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Do thing' }));
      expect(onAction).toHaveBeenCalledOnce();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  describe('toggle items', () => {
    it('calls onToggle and keeps menu open', () => {
      const onToggle = vi.fn();
      const items: MenuItem[] = [
        { kind: 'toggle', label: 'Dark mode', checked: false, onToggle },
      ];
      renderMenu(items);
      openMenu();
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Dark mode' }));
      expect(onToggle).toHaveBeenCalledOnce();
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('reflects checked state via aria-checked', () => {
      const items: MenuItem[] = [
        { kind: 'toggle', label: 'Dark mode', checked: true, onToggle: vi.fn() },
      ];
      renderMenu(items);
      openMenu();
      expect(screen.getByRole('menuitemcheckbox')).toHaveAttribute('aria-checked', 'true');
    });

    it('shows checkmark when checked', () => {
      const items: MenuItem[] = [
        { kind: 'toggle', label: 'Dark mode', checked: true, onToggle: vi.fn() },
      ];
      renderMenu(items);
      openMenu();
      expect(screen.getByText('✓')).toBeInTheDocument();
    });

    it('does not show checkmark when unchecked', () => {
      const items: MenuItem[] = [
        { kind: 'toggle', label: 'Dark mode', checked: false, onToggle: vi.fn() },
      ];
      renderMenu(items);
      openMenu();
      expect(screen.queryByText('✓')).not.toBeInTheDocument();
    });
  });

  describe('link items', () => {
    it('renders as an anchor tag with correct href and target', () => {
      const items: MenuItem[] = [
        { kind: 'link', label: 'GitHub', href: 'https://github.com/example' },
      ];
      renderMenu(items);
      openMenu();
      const link = screen.getByRole('link', { name: 'GitHub' });
      expect(link).toHaveAttribute('href', 'https://github.com/example');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('closes menu on click', () => {
      const items: MenuItem[] = [
        { kind: 'link', label: 'GitHub', href: 'https://github.com/example' },
      ];
      renderMenu(items);
      openMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'GitHub' }));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('renders icon when provided', () => {
      const items: MenuItem[] = [
        { kind: 'link', label: 'GitHub', href: 'https://github.com/example', icon: <span data-testid="icon">*</span> },
      ];
      renderMenu(items);
      openMenu();
      expect(screen.getByTestId('icon')).toBeInTheDocument();
    });

    it('participates in keyboard navigation', () => {
      const items: MenuItem[] = [
        { kind: 'action', label: 'Import', onAction: vi.fn() },
        { kind: 'link', label: 'GitHub', href: 'https://github.com/example' },
      ];
      renderMenu(items);
      openMenu();
      const menu = screen.getByRole('menu');
      fireEvent.keyDown(menu, { key: 'ArrowDown' }); // Import
      fireEvent.keyDown(menu, { key: 'ArrowDown' }); // GitHub
      expect(screen.getByRole('menuitem', { name: 'GitHub' })).toHaveFocus();
    });
  });

  describe('separators', () => {
    it('renders separator with role=separator', () => {
      renderMenu();
      openMenu();
      expect(screen.getByRole('separator')).toBeInTheDocument();
    });
  });

  describe('keyboard navigation', () => {
    it('no item is highlighted on click-open', () => {
      renderMenu();
      openMenu();
      const items = screen.getAllByRole('menuitem');
      // No item should have focus after mouse-click open
      for (const item of items) {
        expect(item).not.toHaveFocus();
      }
    });

    it('first ArrowDown from click-open focuses first item', () => {
      renderMenu();
      openMenu();
      const menu = screen.getByRole('menu');
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
    });

    it('ArrowDown moves to next focusable item', () => {
      renderMenu();
      openMenu();
      const menu = screen.getByRole('menu');
      const items = screen.getAllByRole('menuitem');

      fireEvent.keyDown(menu, { key: 'ArrowDown' }); // Import
      fireEvent.keyDown(menu, { key: 'ArrowDown' }); // Export
      expect(items[1]).toHaveFocus();
    });

    it('ArrowUp from click-open focuses last item', () => {
      renderMenu();
      openMenu();
      const menu = screen.getByRole('menu');
      fireEvent.keyDown(menu, { key: 'ArrowUp' });
      expect(screen.getByRole('menuitemcheckbox')).toHaveFocus();
    });

    it('ArrowUp moves to previous focusable item', () => {
      renderMenu();
      openMenu();
      const menu = screen.getByRole('menu');

      // Navigate down twice then up
      fireEvent.keyDown(menu, { key: 'ArrowDown' }); // Import
      fireEvent.keyDown(menu, { key: 'ArrowDown' }); // Export
      fireEvent.keyDown(menu, { key: 'ArrowUp' });   // back to Import

      const items = screen.getAllByRole('menuitem');
      expect(items[0]).toHaveFocus();
    });

    it('ArrowDown skips separators', () => {
      renderMenu();
      openMenu();
      const menu = screen.getByRole('menu');
      const menuItems = screen.getAllByRole('menuitem');
      const checkbox = screen.getByRole('menuitemcheckbox');

      // ArrowDown x3: Import → Export → skips separator → Dark mode
      fireEvent.keyDown(menu, { key: 'ArrowDown' }); // Import
      fireEvent.keyDown(menu, { key: 'ArrowDown' }); // Export
      fireEvent.keyDown(menu, { key: 'ArrowDown' }); // skips separator → Dark mode
      expect(checkbox).toHaveFocus();

      // Move back up should skip separator and land on Export
      fireEvent.keyDown(menu, { key: 'ArrowUp' });
      expect(menuItems[1]).toHaveFocus();
    });

    it('Enter activates focused action item', () => {
      const onAction = vi.fn();
      const items: MenuItem[] = [
        { kind: 'action', label: 'Do thing', onAction },
      ];
      renderMenu(items);
      openMenu();
      const menu = screen.getByRole('menu');
      fireEvent.keyDown(menu, { key: 'ArrowDown' }); // focus first item
      fireEvent.keyDown(menu, { key: 'Enter' });
      expect(onAction).toHaveBeenCalledOnce();
    });

    it('Space activates focused toggle item', () => {
      const onToggle = vi.fn();
      const items: MenuItem[] = [
        { kind: 'toggle', label: 'Dark mode', checked: false, onToggle },
      ];
      renderMenu(items);
      openMenu();
      const menu = screen.getByRole('menu');
      fireEvent.keyDown(menu, { key: 'ArrowDown' }); // focus first item
      fireEvent.keyDown(menu, { key: ' ' });
      expect(onToggle).toHaveBeenCalledOnce();
    });

    it('Home moves to first focusable item', () => {
      renderMenu();
      openMenu();
      const menu = screen.getByRole('menu');
      fireEvent.keyDown(menu, { key: 'ArrowDown' }); // Import
      fireEvent.keyDown(menu, { key: 'ArrowDown' }); // Export (move off first)
      fireEvent.keyDown(menu, { key: 'Home' });
      expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
    });

    it('End moves to last focusable item', () => {
      renderMenu();
      openMenu();
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
      expect(screen.getByRole('menuitemcheckbox')).toHaveFocus();
    });

    it('wraps around from last to first', () => {
      renderMenu();
      openMenu();
      const menu = screen.getByRole('menu');
      // Go to end then one more
      fireEvent.keyDown(menu, { key: 'End' });
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
    });
  });
});
