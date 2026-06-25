"use client";

import { useState } from "react";
import { ListTodo, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  addTodo,
  deleteTodo,
  toggleTodo,
  type TodoRow,
} from "@/app/(app)/todos/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function MiniTodo({ initial }: { initial: TodoRow[] }) {
  const [todos, setTodos] = useState<TodoRow[]>(initial);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);

  async function add() {
    const t = text.trim();
    if (!t || adding) return;
    setAdding(true);
    setText("");
    // Optimistic: show it immediately with a temp id.
    const tempId = `temp-${Date.now()}`;
    setTodos((p) => [{ id: tempId, text: t, done: false }, ...p]);
    const res = await addTodo(t);
    setAdding(false);
    if (!res.ok) {
      setTodos((p) => p.filter((x) => x.id !== tempId));
      toast.error(res.error);
      return;
    }
    setTodos((p) => p.map((x) => (x.id === tempId ? res.todo : x)));
  }

  async function toggle(item: TodoRow) {
    const next = !item.done;
    setTodos((p) => p.map((x) => (x.id === item.id ? { ...x, done: next } : x)));
    const res = await toggleTodo(item.id, next);
    if (!res.ok) {
      setTodos((p) =>
        p.map((x) => (x.id === item.id ? { ...x, done: item.done } : x)),
      );
      toast.error("Couldn't sync. Try again.");
    }
  }

  async function remove(item: TodoRow) {
    setTodos((p) => p.filter((x) => x.id !== item.id));
    const res = await deleteTodo(item.id);
    if (!res.ok) {
      setTodos((p) => [item, ...p]);
      toast.error("Couldn't delete. Try again.");
    }
  }

  const open = todos.filter((t) => !t.done).length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ListTodo className="text-primary size-5" /> My to-do
        </CardTitle>
        {todos.length > 0 && (
          <span className="text-muted-foreground text-xs font-semibold">
            {open} open
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add a task…"
            className="h-9"
            maxLength={300}
          />
          <Button
            size="icon"
            className="size-9 shrink-0"
            onClick={add}
            disabled={adding}
            aria-label="Add task"
          >
            {adding ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
          </Button>
        </div>

        {todos.length === 0 ? (
          <p className="text-muted-foreground py-2 text-center text-sm">
            Your personal task list — it syncs across your devices.
          </p>
        ) : (
          <ul className="space-y-1">
            {todos.map((t) => (
              <li
                key={t.id}
                className="hover:bg-accent group flex items-center gap-2 rounded-lg px-1.5 py-1.5"
              >
                <button
                  onClick={() => toggle(t)}
                  aria-label={t.done ? "Mark not done" : "Mark done"}
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
                    t.done
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-input",
                  )}
                >
                  {t.done && (
                    <svg
                      viewBox="0 0 24 24"
                      className="size-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    t.done && "text-muted-foreground line-through",
                  )}
                >
                  {t.text}
                </span>
                <button
                  onClick={() => remove(t)}
                  aria-label="Delete task"
                  className="text-muted-foreground hover:text-destructive shrink-0 p-1 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
