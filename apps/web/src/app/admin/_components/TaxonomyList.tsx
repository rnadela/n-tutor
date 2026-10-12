'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Eye, EyeOff, Inbox, Pencil } from 'lucide-react';
import { RowActions } from '@/components/RowActions';
import { CardField, CardList, TableCard, TableOnDesktop } from '@/components/TableCards';
import { adminCopy } from '@/copy/admin';
import type { TaxonomyItem } from '@/lib/admin-api';
import { density, rounded } from '@/theme/tokens';

export interface TaxonomyListProps {
  heading: string;
  idPrefix: string;
  newItemLabel: string;
  addLabel: string;
  emptyLabel: string;
  items: TaxonomyItem[];
  /** Resolves `true` only when the write succeeded. */
  onCreate: (name: string) => Promise<boolean>;
  onRename: (item: TaxonomyItem, name: string) => Promise<boolean>;
  onSetEnabled: (item: TaxonomyItem, enabled: boolean) => Promise<boolean>;
}

/**
 * The list, at two widths (UX-DR44).
 *
 * From the desktop breakpoint it is the three-column table it has always been;
 * below it every row is a card titled by the item's name, with its status as a
 * labeled field and its actions at the top-right. Both layouts render from the
 * one set of state — `renamingId`, `renameDraft` and `pendingIds` — and the
 * choice between them is `display`, so nothing swaps after first paint.
 *
 * Every row-scoped `id` stays the table's and the card's is suffixed `-card`: the
 * same row is in the markup twice, and a `<label>` pointing at an `id` that
 * appears twice is a label bound to whichever came first.
 */
export function TaxonomyList(props: TaxonomyListProps) {
  const { heading, idPrefix, items } = props;
  const [draft, setDraft] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // One write at a time per control, so a double-click cannot issue duplicate
  // requests whose responses land out of order.
  const [creating, setCreating] = useState(false);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  const isPending = (id: string) => pendingIds.has(id);

  async function withPending(id: string, run: () => Promise<boolean>): Promise<boolean> {
    if (pendingIds.has(id)) return false;
    setPendingIds((current) => new Set(current).add(id));
    try {
      return await run();
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  /**
   * The rename form, in whichever layout is asking for it.
   *
   * `idSuffix` is empty in the table and `-card` on the card, so the one visible
   * input is the one its own label points at.
   */
  function renameForm(item: TaxonomyItem, idSuffix: string) {
    return (
      <Box
        component="form"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: `${density.gap}px`, flex: 1, minWidth: 0 }}
        onSubmit={async (event) => {
          event.preventDefault();
          const name = renameDraft.trim();
          if (!name || isPending(item.id)) return;
          const saved = await withPending(item.id, () => props.onRename(item, name));
          if (saved) setRenamingId(null);
        }}
      >
        <TextField
          id={`${idPrefix}-rename-${item.id}${idSuffix}`}
          label={adminCopy.taxonomy.renameLabel}
          value={renameDraft}
          onChange={(event) => setRenameDraft(event.target.value)}
          size="small"
          sx={{ minWidth: 180, flex: 1 }}
        />
        <Button type="submit" variant="contained" disabled={isPending(item.id)}>
          {adminCopy.taxonomy.saveName}
        </Button>
        <Button type="button" onClick={() => setRenamingId(null)}>
          {adminCopy.taxonomy.cancelRename}
        </Button>
      </Box>
    );
  }

  /** Enabled or disabled, told by a dot and by the word beside it. */
  function statusContent(item: TaxonomyItem) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Box
          aria-hidden
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: item.enabled ? 'success.main' : 'text.secondary',
            flexShrink: 0,
          }}
        />
        {item.enabled ? adminCopy.taxonomy.enabled : adminCopy.taxonomy.disabled}
      </Box>
    );
  }

  /**
   * The row's actions, unchanged in either layout.
   *
   * The pencil says "rename" standing alone; "disable" does not, so it keeps its
   * word and goes behind the ⋮ (UX-DR43). Both keep the accessible name, the
   * pending state and the handler they had as text buttons.
   */
  function rowActions(item: TaxonomyItem) {
    return (
      <RowActions
        menuLabel={adminCopy.rowActionsLabel(item.name)}
        actions={[
          {
            key: 'rename',
            label: adminCopy.taxonomy.rename,
            ariaLabel: `${adminCopy.taxonomy.rename} ${item.name}`,
            icon: <Pencil size={16} aria-hidden="true" />,
            selfEvident: true,
            onClick: () => {
              setRenamingId(item.id);
              setRenameDraft(item.name);
            },
          },
          {
            key: 'enabled',
            label: item.enabled ? adminCopy.taxonomy.disable : adminCopy.taxonomy.enable,
            ariaLabel: `${
              item.enabled ? adminCopy.taxonomy.disable : adminCopy.taxonomy.enable
            } ${item.name}`,
            icon: item.enabled ? (
              <EyeOff size={16} aria-hidden="true" />
            ) : (
              <Eye size={16} aria-hidden="true" />
            ),
            disabled: isPending(item.id),
            onClick: () => {
              void withPending(item.id, () => props.onSetEnabled(item, !item.enabled));
            },
          },
        ]}
      />
    );
  }

  return (
    <Card component="section" aria-labelledby={`${idPrefix}-heading`}>
      <CardContent sx={{ display: 'grid', gap: `${density.gap}px` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: `${density.gap}px` }}>
          <Typography id={`${idPrefix}-heading`} component="h2" variant="cardTitle">
            {heading}
          </Typography>
          {/* How many there are, at a glance. Decorative: the table states each one. */}
          <Box
            component="span"
            aria-hidden="true"
            sx={{
              px: `${density.gap}px`,
              borderRadius: 999,
              bgcolor: 'action.selected',
              fontSize: '0.8125rem',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {items.length}
          </Box>
        </Box>

        <Box
          component="form"
          sx={{ display: 'flex', gap: `${density.gap}px`, alignItems: 'flex-start' }}
          onSubmit={async (event) => {
            event.preventDefault();
            const name = draft.trim();
            if (!name || creating) return;
            setCreating(true);
            try {
              // Only clear on success; a rejected name must survive the error.
              if (await props.onCreate(name)) setDraft('');
            } finally {
              setCreating(false);
            }
          }}
        >
          <TextField
            id={`${idPrefix}-new-name`}
            label={props.newItemLabel}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            size="small"
            sx={{ flex: 1 }}
          />
          {/* Disabled only while a write is in flight — never for an empty
              input, which would drop the control out of the tab order. */}
          <Button type="submit" variant="contained" disabled={creating}>
            {props.addLabel}
          </Button>
        </Box>

        {items.length === 0 ? (
          <Box
            sx={{
              display: 'grid',
              justifyItems: 'center',
              gap: `${density.gap}px`,
              py: `${density.sectionMargin * 1.5}px`,
              px: `${density.cardPadding}px`,
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: `${rounded.control}px`,
              color: 'text.secondary',
              textAlign: 'center',
            }}
          >
            <Inbox size={28} aria-hidden="true" />
            <Typography component="p">{props.emptyLabel}</Typography>
          </Box>
        ) : (
          <>
            {/* A long list scrolls inside its own card, header pinned, so a short
              one beside it does not leave the page with a column of dead space. */}
            <TableOnDesktop>
              <TableContainer sx={{ maxHeight: 440 }}>
                <Table
                  size="small"
                  stickyHeader
                  aria-labelledby={`${idPrefix}-heading`}
                  sx={{
                    '& thead th': {
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'text.secondary',
                      bgcolor: 'background.paper',
                    },
                  }}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell component="th" scope="col">
                        {adminCopy.taxonomy.nameColumn}
                      </TableCell>
                      <TableCell component="th" scope="col">
                        {adminCopy.taxonomy.statusColumn}
                      </TableCell>
                      <TableCell component="th" scope="col">
                        {adminCopy.taxonomy.actionsColumn}
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow
                        key={item.id}
                        data-testid={`${idPrefix}-row`}
                        data-name={item.name}
                        sx={{ '&:hover': { bgcolor: 'action.hover' } }}
                      >
                        <TableCell>
                          {renamingId === item.id ? renameForm(item, '') : item.name}
                        </TableCell>
                        <TableCell>{statusContent(item)}</TableCell>
                        <TableCell>{rowActions(item)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </TableOnDesktop>

            {/* The same rows below the desktop breakpoint: the name is the card's
              title, the status its one field, and the actions sit top-right. */}
            <CardList label={heading} testId={`${idPrefix}-cards`}>
              {items.map((item) => (
                <TableCard
                  key={item.id}
                  title={item.name}
                  titleContent={renamingId === item.id ? renameForm(item, '-card') : undefined}
                  actions={rowActions(item)}
                  testId={`${idPrefix}-card`}
                  dataAttributes={{ 'data-name': item.name }}
                >
                  <CardField label={adminCopy.taxonomy.statusColumn} value={statusContent(item)} />
                </TableCard>
              ))}
            </CardList>
          </>
        )}
      </CardContent>
    </Card>
  );
}
