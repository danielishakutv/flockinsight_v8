"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useOptionalT } from "@/components/i18n-provider";

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>,
) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(
  props: React.ComponentProps<typeof DialogPrimitive.Portal>,
) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(
  props: React.ComponentProps<typeof DialogPrimitive.Close>,
) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  /*
   * useOptionalT, not useT: a primitive must never assume a provider.
   * `useT()` throws without one, and this dialog renders in trees that have
   * none of their own — so a missing provider would be a blank page rather
   * than an untranslated word. Falls back to English, which for a key named
   * after its words is exactly the English.
   */
  const t = useOptionalT();
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          /*
           * The height cap is the mobile fix.
           *
           * Width was already handled. Height was not: the panel is centred
           * with `top-1/2 -translate-y-1/2`, so a form taller than the screen
           * used to overflow BOTH edges with nothing to scroll — and the close
           * button, being at the top, went off the top of the screen with it.
           * On a 667px phone that is an unclosable dialog.
           *
           * `max-h` plus a scrolling body fixes it without changing how any
           * dialog looks on a desktop, where none of them is that tall.
           */
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] flex-col gap-4 overflow-y-auto overscroll-contain rounded-2xl border p-6 shadow-lg duration-200 [&>*]:min-w-0 sm:max-h-[calc(100dvh-4rem)] sm:max-w-lg [&.gap-0]:[--dialog-close-gap:0px] [&.p-0]:[--dialog-close-nudge:1rem] [&.p-0]:[--dialog-close-top:0px]",
          className,
        )}
        {...props}
      >
        {children}
        {/*
          Sticky, genuinely. The panel is the scroller, and the X used to be
          `absolute top-4 right-4` inside it — an absolute child of a scroll
          container moves with the content, so on a phone the X scrolled away
          as soon as a long form was scrolled, and a dialog with no Cancel (or
          one that blocks closing while pending) left only the overlay.

          A zero-height row pinned 1.5rem down (the panel's p-6), shown
          first with `order-first` but LAST in the DOM, so Radix still focuses
          the first field on open and Tab still reaches the X last.
          `-mb-[gap]` cancels the flex gap the row would otherwise add, so no
          dialog's layout moves; the X itself overflows the row downwards, and
          `-mt-2 -mr-2` lands it where `top-4 right-4` used to.

          Panels that set `p-0` or `gap-0` (the command palettes, the link
          picker) are caught by the `[&.p-0]` / `[&.gap-0]` variables on the
          panel above: with no padding the row sits at 0 (a sticky top of 1.5rem
          would push it DOWN, since sticky also holds an unscrolled element off
          the edge) and the X moves 1rem in instead of 0.5rem out; with no gap
          there is nothing to cancel.
        */}
        <div
          data-slot="dialog-close-row"
          className="pointer-events-none sticky top-[var(--dialog-close-top,1.5rem)] z-10 order-first -mb-[var(--dialog-close-gap,1rem)] flex h-0 shrink-0 justify-end"
        >
          <DialogPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent bg-background/80 pointer-events-auto mt-[var(--dialog-close-nudge,-0.5rem)] mr-[var(--dialog-close-nudge,-0.5rem)] grid size-11 shrink-0 place-items-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:pointer-events-none sm:size-8">
            <XIcon className="size-4" />
            <span className="sr-only">{t("ui.close")}</span>
          </DialogPrimitive.Close>
        </div>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 text-center sm:text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg font-bold", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
