import React from 'react';
import { ArrowDownAZ, ArrowUpAZ, Check, ChevronsUpDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const compareLabels = (left, right, direction) => {
  const multiplier = direction === 'desc' ? -1 : 1;
  return multiplier * left.localeCompare(right, 'de', { sensitivity: 'base' });
};

export default function EmployeeSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Mitarbeiter auswahlen',
  searchPlaceholder = 'Mitarbeiter suchen...',
  emptyText = 'Keine Mitarbeiter gefunden.',
  disabled = false,
  triggerClassName,
  contentClassName,
  align = 'start',
  triggerTestId,
  optionTestIdPrefix,
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [sortDirection, setSortDirection] = React.useState('asc');

  const selectedOption = React.useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  );

  const filteredOptions = React.useMemo(() => {
    const normalizedQuery = normalizeText(search);

    return [...options]
      .filter((option) => {
        if (!normalizedQuery) {
          return true;
        }

        const haystack = normalizeText([
          option.label,
          option.description,
          option.searchText,
          ...(option.keywords || []),
        ].filter(Boolean).join(' '));

        return haystack.includes(normalizedQuery);
      })
      .sort((left, right) => compareLabels(left.sortLabel || left.label || '', right.sortLabel || right.label || '', sortDirection));
  }, [options, search, sortDirection]);

  React.useEffect(() => {
    if (!open) {
      setSearch('');
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={selectedOption ? selectedOption.triggerLabel || selectedOption.label : placeholder}
          data-testid={triggerTestId}
          className={cn('w-full justify-between font-normal', triggerClassName)}
          disabled={disabled}
        >
          <span className="truncate text-left">
            {selectedOption ? selectedOption.triggerLabel || selectedOption.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-[320px] p-0', contentClassName)} align={align}>
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs text-muted-foreground">Sortierung</span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant={sortDirection === 'asc' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2"
                onClick={() => setSortDirection('asc')}
              >
                <ArrowUpAZ className="h-3.5 w-3.5" />
                A-Z
              </Button>
              <Button
                type="button"
                variant={sortDirection === 'desc' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2"
                onClick={() => setSortDirection('desc')}
              >
                <ArrowDownAZ className="h-3.5 w-3.5" />
                Z-A
              </Button>
            </div>
          </div>
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {filteredOptions.map((option) => {
              const isSelected = option.value === value;

              return (
                <CommandItem
                  key={option.value}
                  value={[option.label, option.description, option.searchText].filter(Boolean).join(' ')}
                  data-testid={optionTestIdPrefix ? `${optionTestIdPrefix}${option.value}` : undefined}
                  className={cn('items-start', option.itemClassName)}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <div className={cn(
                    'mt-0.5 flex h-4 w-4 items-center justify-center rounded-sm border',
                    isSelected
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-300 text-transparent'
                  )}>
                    <Check className="h-3 w-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{option.label}</div>
                    {option.description ? (
                      <div className="truncate text-xs text-muted-foreground">{option.description}</div>
                    ) : null}
                  </div>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
