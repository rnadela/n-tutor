'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import { MoreVertical } from 'lucide-react';

/**
 * One action offered on one table row.
 *
 * `ariaLabel` is the accessible name, and it names the row's object — "Rename
 * Algebra", not "Rename". An icon-only control whose name is the bare verb is
 * one of nine identical controls to anybody not reading the screen with their
 * eyes, and the same is true of a menu item once the menu is open away from the
 * row it belongs to.
 */
export interface RowAction {
  /** Stable across renders: it keys the inline button or the menu item. */
  key: string;
  /** The action's name, shown in the tooltip and in the menu item. */
  label: string;
  /** Drawn inside the control. Decorative — the accessible name is the label. */
  icon: React.ReactNode;
  onClick(): void;
  disabled?: boolean;
  /** Renders last in the menu, after a divider, in the error colour. */
  destructive?: boolean;
  /**
   * Whether the icon alone says what the action is. Exactly three do: the
   * pencil (rename), the trash (delete), and the chevron (expand/collapse).
   * Everything else is a guess dressed as a glyph, and goes in the menu.
   */
  selfEvident?: boolean;
  /** The accessible name, naming the row's object. */
  ariaLabel?: string;
  /** For a disclosure action: the state of what it opens. */
  expanded?: boolean;
  /** For a disclosure action: the id of what it opens. */
  controls?: string;
}

/**
 * Which actions stay on the row and which go behind the `⋮` (UX-DR43).
 *
 * **A pure function, not a render-time condition.** `apps/web` runs vitest with
 * `environment: 'node'` and ships no DOM testing library, and a closed MUI
 * `Menu` renders nothing into static markup — so the one rule this component
 * exists to enforce has to be assertable without a browser.
 *
 * The cap is two icons per row **counting the `⋮` itself**, which is why a row
 * with one self-evident action and one that is not keeps exactly one inline.
 */
export function planRowActions<A extends RowAction>(actions: A[]): { inline: A[]; menu: A[] } {
  if (actions.length === 0) return { inline: [], menu: [] };
  if (actions.length > 2) return { inline: [], menu: actions };
  const selfEvident = actions.filter((a) => a.selfEvident === true);
  if (selfEvident.length === actions.length) return { inline: actions, menu: [] };
  // A ⋮ is itself one of the two allowed icons, so at most one action stays inline.
  return { inline: selfEvident.slice(0, 1), menu: actions.filter((a) => a !== selfEvident[0]) };
}

/**
 * The menu's order: destructive items last.
 *
 * Its own function for the reason `planRowActions` is one — and because the
 * divider and the error colour are only meaningful if the thing they set apart
 * is at the bottom. A stable partition, so everything else keeps the order the
 * caller listed it in.
 */
export function orderMenuActions<A extends RowAction>(menu: A[]): A[] {
  return [
    ...menu.filter((action) => action.destructive !== true),
    ...menu.filter((action) => action.destructive === true),
  ];
}

/** One row of the open menu: the action, and whether a rule sits above it. */
export interface MenuRow<A extends RowAction> {
  action: A;
  dividedAbove: boolean;
}

/**
 * The open menu's rows, in order, each saying whether a divider precedes it.
 *
 * A pure function for the same reason the cap is one: a closed MUI `Menu`
 * renders nothing into static markup, so a divider decided inside the render
 * would be a decision no `node`-runner spec could reach. One rule, above the
 * destructive block as a whole — a row with two destructive actions wants them
 * set apart from the rest, not from each other — and never above the first
 * item, where a rule separates a menu from its own edge.
 */
export function planMenuRows<A extends RowAction>(menu: A[]): MenuRow<A>[] {
  const ordered = orderMenuActions(menu);
  return ordered.map((action, index) => ({
    action,
    dividedAbove:
      action.destructive === true && index > 0 && ordered[index - 1]?.destructive !== true,
  }));
}

export interface RowActionsProps {
  actions: RowAction[];
  /**
   * The `⋮` trigger's accessible name and tooltip, naming the row's object.
   * Comes from `copy/*.ts` like every other string.
   */
  menuLabel: string;
}

/**
 * Every table's per-row actions, in one place (UX-DR43).
 *
 * Icon-only buttons on the row, at most two counting the `⋮`; everything that
 * needs a word goes behind the `⋮`, where it is shown with its icon *and* its
 * label. A text button per action is what makes an action cell wrap onto three
 * lines on a phone, and a row of unlabelled glyphs is what makes it
 * unreadable — the menu is the only placement that is neither.
 *
 * It changes no action's behaviour: the handler, the confirmation it opens, its
 * pending state and whatever the screen announces afterwards all stay with the
 * caller.
 */
export function RowActions({ actions, menuLabel }: RowActionsProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { inline, menu } = planRowActions(actions);
  const rows = planMenuRows(menu);

  // Nothing at all for a row with nothing to do — never a `⋮` that opens onto
  // an empty menu.
  if (inline.length === 0 && rows.length === 0) return null;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {inline.map((action) => (
        // On hover *and* on focus, because a keyboard is how half of these are
        // reached and a tooltip that only answers a mouse answers nobody there.
        <Tooltip key={action.key} title={action.label}>
          <IconButton
            type="button"
            size="small"
            aria-label={action.ariaLabel ?? action.label}
            aria-expanded={action.expanded}
            aria-controls={action.controls}
            disabled={action.disabled === true}
            onClick={action.onClick}
          >
            {action.icon}
          </IconButton>
        </Tooltip>
      ))}

      {rows.length > 0 && (
        <>
          <Tooltip title={menuLabel}>
            <IconButton
              type="button"
              size="small"
              aria-label={menuLabel}
              aria-haspopup="menu"
              aria-expanded={anchor !== null}
              onClick={(event) => setAnchor(event.currentTarget)}
            >
              <MoreVertical size={16} aria-hidden="true" />
            </IconButton>
          </Tooltip>
          {/* MUI's Menu owns the keyboard contract this story asks for: Enter,
              Space and click open it, the arrows move between items, Escape and
              a chosen item close it, and focus returns to the trigger. */}
          <Menu
            open={anchor !== null}
            anchorEl={anchor}
            onClose={() => setAnchor(null)}
            slotProps={{ list: { 'aria-label': menuLabel } }}
          >
            {rows.map(({ action, dividedAbove }) => {
              const item = (
                <MenuItem
                  key={action.key}
                  aria-label={action.ariaLabel ?? action.label}
                  aria-expanded={action.expanded}
                  aria-controls={action.controls}
                  disabled={action.disabled === true}
                  onClick={() => {
                    setAnchor(null);
                    action.onClick();
                  }}
                  sx={action.destructive === true ? { color: 'error.main' } : undefined}
                >
                  <ListItemIcon sx={{ color: 'inherit' }}>{action.icon}</ListItemIcon>
                  <ListItemText>{action.label}</ListItemText>
                </MenuItem>
              );
              // A rule above the destructive block, so its first item is not
              // the next thing down from the one a parent meant to press.
              return dividedAbove ? [<Divider key={`${action.key}-divider`} />, item] : item;
            })}
          </Menu>
        </>
      )}
    </Box>
  );
}
