"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  matchesNormalized,
  normalizeSearchText,
  searchTokens,
  splitOnMatches,
} from "@/lib/option-search";

/** Layout effect on the client, no-op during SSR. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/* ------------------------------------------------------------------ *
 * Search plumbing
 *
 * Every <SelectContent> can filter its own options. Items register their
 * label text in a stable registry (so the effect doesn't re-run on every
 * keystroke) and read the current query from a second context.
 * ------------------------------------------------------------------ */

type Registry = {
  register: (id: string, text: string) => void;
  unregister: (id: string) => void;
};

type SearchState = {
  enabled: boolean;
  query: string;
  tokens: string[];
};

const SelectRegistryContext = React.createContext<Registry | null>(null);
const SelectSearchContext = React.createContext<SearchState | null>(null);
/**
 * Radix keeps a closed dropdown's options mounted (detached) so the trigger can
 * still show the selected label, so the content can't tell open from closed on
 * its own — the root passes it down.
 */
const SelectOpenContext = React.createContext<boolean>(true);

/** Number of options from which the search field appears on its own. */
const AUTO_SEARCH_THRESHOLD = 8;

/** Best-effort plain text for an item's children, used as the haystack. */
function textFromChildren(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromChildren).join(" ");
  if (React.isValidElement(node)) {
    return textFromChildren(
      (node.props as { children?: React.ReactNode }).children,
    );
  }
  return "";
}

const VISIBLE_ITEM = '[data-slot="select-item"]:not([data-filtered-out])';

function visibleItems(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(VISIBLE_ITEM)).filter(
    (el) => el.getAttribute("data-disabled") === null,
  );
}

/** Select an item the same way a real Enter key press on it would. */
function activateItem(item: HTMLElement) {
  item.focus({ preventScroll: true });
  item.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
}

function Select({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    defaultOpen ?? false,
  );
  const isOpen = open ?? uncontrolledOpen;

  return (
    <SelectOpenContext.Provider value={isOpen}>
      <SelectPrimitive.Root
        data-slot="select"
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={(next) => {
          setUncontrolledOpen(next);
          onOpenChange?.(next);
        }}
        {...props}
      />
    </SelectOpenContext.Provider>
  );
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      // Hide the whole group (and its label) once search filters out every item.
      className={cn(
        "[&:not(:has([data-slot=select-item]:not([data-filtered-out])))]:hidden",
        className,
      )}
      {...props}
    />
  );
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default" | "lg";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "group/select-trigger border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive flex w-full items-center justify-between gap-2 rounded-lg border bg-transparent px-3.5 py-2 text-left text-base shadow-sm transition-[color,box-shadow,background-color] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-11 data-[size=lg]:h-12 data-[size=sm]:h-9 data-[state=open]:border-ring data-[state=open]:ring-ring/50 data-[state=open]:ring-[3px] data-[state=closed]:hover:bg-accent/40 disabled:hover:bg-transparent *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 *:data-[slot=select-value]:text-left [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 md:text-sm",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 shrink-0 opacity-50 transition-transform duration-200 group-data-[state=open]/select-trigger:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  searchable = "auto",
  searchPlaceholder = "Search…",
  emptyMessage = "No matches found",
  searchThreshold = AUTO_SEARCH_THRESHOLD,
  onKeyDown,
  onEscapeKeyDown,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  /** `true` always shows the search field, `false` never, `"auto"` past `searchThreshold` options. */
  searchable?: boolean | "auto";
  searchPlaceholder?: string;
  emptyMessage?: string;
  searchThreshold?: number;
}) {
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const open = React.useContext(SelectOpenContext);

  // Every visit starts from a clean list.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open && query !== "") setQuery("");
  }

  // Option labels, collected from the items themselves. Changes are queued and
  // applied in one microtask so mounting 200 members costs a single re-render.
  const [labels, setLabels] = React.useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const queuedRef = React.useRef(new Map<string, string | null>());
  const scheduledRef = React.useRef(false);
  const registry = React.useMemo<Registry>(() => {
    const flush = () => {
      if (scheduledRef.current) return;
      scheduledRef.current = true;
      queueMicrotask(() => {
        scheduledRef.current = false;
        const queued = queuedRef.current;
        if (queued.size === 0) return;
        queuedRef.current = new Map();
        setLabels((previous) => {
          const next = new Map(previous);
          for (const [id, text] of queued) {
            if (text === null) next.delete(id);
            else next.set(id, text);
          }
          return next;
        });
      });
    };
    return {
      register: (id, text) => {
        queuedRef.current.set(id, text);
        flush();
      },
      unregister: (id) => {
        queuedRef.current.set(id, null);
        flush();
      },
    };
  }, []);

  const total = labels.size;
  const enabled =
    searchable === true || (searchable === "auto" && total >= searchThreshold);
  const tokens = React.useMemo(
    () => (enabled ? searchTokens(query) : []),
    [enabled, query],
  );
  const search = React.useMemo<SearchState>(
    () => ({ enabled, query, tokens }),
    [enabled, query, tokens],
  );

  const visibleCount =
    tokens.length === 0
      ? total
      : Array.from(labels.values()).filter((text) =>
          matchesNormalized(text, tokens),
        ).length;
  const showEmpty = enabled && tokens.length > 0 && total > 0 && visibleCount === 0;

  // While searching, mark the option Enter would pick and bring the matches
  // into view (the list is normally scrolled to the current selection).
  const searchKey = tokens.join(" ");
  React.useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    root
      .querySelectorAll("[data-active-option]")
      .forEach((el) => el.removeAttribute("data-active-option"));

    const viewport = root.querySelector<HTMLElement>(
      '[data-slot="select-viewport"]',
    );
    if (viewport) {
      if (searchKey !== "") viewport.scrollTop = 0;
      // Radix only re-checks its scroll arrows on a scroll event, and the list
      // just changed height — nudge it so a stray arrow doesn't hang around.
      viewport.dispatchEvent(new Event("scroll"));
    }

    if (!enabled || searchKey === "") return;
    const [first] = visibleItems(root);
    first?.setAttribute("data-active-option", "");
  }, [enabled, searchKey, visibleCount]);

  // Typing while an option has focus (mouse hover moves focus onto options)
  // should go to the search field rather than Radix's typeahead.
  function handleContentKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    const input = inputRef.current;
    if (!enabled || !input || event.defaultPrevented) return;
    if (event.target === input) return;

    if (event.key === "ArrowUp") {
      const [first] = visibleItems(contentRef.current);
      if (first && first === event.target) {
        event.preventDefault();
        input.focus({ preventScroll: true });
      }
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      setQuery((q) => q.slice(0, -1));
      input.focus({ preventScroll: true });
      return;
    }
    const isModified = event.ctrlKey || event.altKey || event.metaKey;
    if (!isModified && event.key.length === 1 && event.key !== " ") {
      event.preventDefault();
      setQuery((q) => q + event.key);
      input.focus({ preventScroll: true });
    }
  }

  // First Escape clears the search, a second one closes the dropdown.
  function handleEscapeKeyDown(event: KeyboardEvent) {
    onEscapeKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (enabled && query) {
      event.preventDefault();
      setQuery("");
      inputRef.current?.focus({ preventScroll: true });
    }
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") return; // handled by handleEscapeKeyDown
    if (event.key === "Enter") {
      // With a query, Enter takes the top match; without one it just confirms
      // what is already selected rather than jumping to the first option.
      const items = visibleItems(contentRef.current);
      const target = query
        ? items[0]
        : items.find((item) => item.dataset.state === "checked");
      if (target) {
        event.preventDefault();
        event.stopPropagation();
        activateItem(target);
      }
      return;
    }
    // Arrows / Home / End / Tab belong to Radix's roving focus.
    if (["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) return;
    // Everything else stays in the input instead of triggering typeahead.
    event.stopPropagation();
  }

  return (
    <SelectPrimitive.Portal>
      <SelectRegistryContext.Provider value={registry}>
        <SelectSearchContext.Provider value={search}>
          <SelectPrimitive.Content
            data-slot="select-content"
            ref={contentRef}
            className={cn(
              "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-hidden rounded-xl border shadow-lg",
              position === "popper" &&
                "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
              className,
            )}
            position={position}
            onKeyDown={handleContentKeyDown}
            onEscapeKeyDown={handleEscapeKeyDown}
            {...props}
          >
            {enabled && (
              <SelectSearchField
                ref={inputRef}
                open={open}
                value={query}
                onValueChange={setQuery}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                resultCount={visibleCount}
              />
            )}
            <SelectScrollUpButton />
            <SelectPrimitive.Viewport
              data-slot="select-viewport"
              className={cn(
                "p-1",
                position === "popper" &&
                  "w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1",
              )}
            >
              {children}
              {showEmpty && (
                <div className="text-muted-foreground px-3 py-6 text-center text-sm">
                  <p className="font-medium">{emptyMessage}</p>
                  <p className="mt-0.5 text-xs opacity-80">
                    Try a different spelling or fewer words.
                  </p>
                </div>
              )}
            </SelectPrimitive.Viewport>
            <SelectScrollDownButton />
          </SelectPrimitive.Content>
        </SelectSearchContext.Provider>
      </SelectRegistryContext.Provider>
    </SelectPrimitive.Portal>
  );
}

function SelectSearchField({
  ref,
  open,
  value,
  onValueChange,
  onKeyDown,
  placeholder,
  resultCount,
}: {
  ref: React.RefObject<HTMLInputElement | null>;
  open: boolean;
  value: string;
  onValueChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  resultCount: number;
}) {
  // Radix focuses the selected option once the popover is positioned; take the
  // focus back so the person can just start typing. On touch we leave it alone
  // so the on-screen keyboard doesn't cover the list before they ask for it.
  React.useEffect(() => {
    const input = ref.current;
    if (!open || !input) return;
    if (!window.matchMedia?.("(pointer: fine)").matches) return;

    const grab = () => input.focus({ preventScroll: true });
    grab();
    const timers = [0, 20, 80].map((delay) => window.setTimeout(grab, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [ref, open]);

  return (
    <div className="bg-popover sticky top-0 z-10 border-b p-1.5">
      <div className="relative flex items-center">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute left-2.5 size-4" />
        <input
          ref={ref}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="done"
          className="placeholder:text-muted-foreground h-9 w-full rounded-md bg-transparent pr-8 pl-8 text-base outline-none md:text-sm"
        />
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onValueChange("");
              ref.current?.focus({ preventScroll: true });
            }}
            className="text-muted-foreground hover:bg-accent hover:text-foreground absolute right-1 flex size-6 items-center justify-center rounded-md transition-colors"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
      <span aria-live="polite" role="status" className="sr-only">
        {value ? `${resultCount} matching options` : ""}
      </span>
    </div>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn(
        "text-muted-foreground px-2 py-1.5 text-xs font-semibold tracking-wide uppercase",
        className,
      )}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  keywords,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & {
  /** Extra terms this option should be findable by (phone number, email, code…). */
  keywords?: string[];
}) {
  const registry = React.useContext(SelectRegistryContext);
  const search = React.useContext(SelectSearchContext);
  const id = React.useId();

  // Normalised once per option: matching a keystroke is then just `includes`.
  const haystack = React.useMemo(
    () =>
      normalizeSearchText(
        [textFromChildren(children), keywords?.join(" ") ?? ""].join(" "),
      ),
    [children, keywords],
  );

  useIsomorphicLayoutEffect(() => {
    if (!registry) return;
    registry.register(id, haystack);
    return () => registry.unregister(id);
  }, [registry, id, haystack]);

  const tokens = search?.enabled ? search.tokens : [];
  const filtering = tokens.length > 0;
  const hidden = filtering && !matchesNormalized(haystack, tokens);

  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      data-filtered-out={hidden ? "" : undefined}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&[data-active-option]]:bg-accent/50 data-[state=checked]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-md py-2.5 pr-8 pl-2 text-base outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=checked]:font-medium [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2 md:py-2 md:text-sm",
        className,
        hidden && "hidden",
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="text-primary size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>
        {filtering && !hidden && typeof children === "string" ? (
          <SelectItemHighlight text={children} tokens={tokens} />
        ) : (
          children
        )}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

/** Bolds the part of the label the person typed. */
function SelectItemHighlight({
  text,
  tokens,
}: {
  text: string;
  tokens: string[];
}) {
  const parts = React.useMemo(() => splitOnMatches(text, tokens), [text, tokens]);
  // One element, so the label keeps flowing as a single run of text (items lay
  // their children out in a flex row with a gap).
  return (
    <span>
      {parts.map((part, index) =>
        part.match ? (
          <mark
            key={index}
            className="bg-primary/15 text-foreground rounded-[3px] font-semibold"
          >
            {part.text}
          </mark>
        ) : (
          <React.Fragment key={index}>{part.text}</React.Fragment>
        ),
      )}
    </span>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "text-muted-foreground flex cursor-default items-center justify-center py-1",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "text-muted-foreground flex cursor-default items-center justify-center py-1",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
