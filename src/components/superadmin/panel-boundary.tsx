"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Keeps one broken panel from taking the page with it.
 *
 * Without this, a single failing query hits the route's error boundary and
 * replaces everything — including the panels that loaded perfectly — with one
 * generic "this section failed to load". That is exactly the rendered state
 * that means five different things: the reader cannot tell whether the page is
 * broken, the data is missing, or one query has a bug, and neither can whoever
 * they report it to.
 *
 * A class component because React error boundaries still have no hook form.
 */
export class PanelBoundary extends Component<
  { title: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Named, not swallowed: the server log is the only place the real cause
    // survives, so it must say which panel and why.
    console.error(`[insights] panel "${this.props.title}" failed`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="rounded-xl border border-dashed p-5">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle
            aria-hidden
            className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
          />
          {this.props.title} could not be worked out
        </p>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          Every other panel on this page is still accurate. The reason is in the
          server log, under &ldquo;[insights] panel&rdquo;.
        </p>
      </div>
    );
  }
}
