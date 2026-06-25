"use client";

import { useEffect, useState } from "react";
import { ListTodo, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Todo = { id: string; text: string; done: boolean };

const KEY = "fi-todos";

export function MiniTodo() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setTodos(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(KEY, JSON.stringify(todos));
  }, [todos, loaded]);

  function add() {
    const t = text.trim();
    if (!t) return;
    setTodos((p) => [{ id: crypto.randomUUID(), text: t, done: false }, ...p]);
    setText("");
  }
  function toggle(id: string) {
    setTodos((p) => p.map((x) => (x.id === id ? { ...x, done: !x.done } : x)));
  }
  function remove(id: string) {
    setTodos((p) => p.filter((x) => x.id !== id));
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
          />
          <Button size="icon" className="size-9 shrink-0" onClick={add} aria-label="Add task">
            <Plus className="size-4" />
          </Button>
        </div>

        {todos.length === 0 ? (
          <p className="text-muted-foreground py-2 text-center text-sm">
            Your personal task list. Add anything you need to remember.
          </p>
        ) : (
          <ul className="space-y-1">
            {todos.map((t) => (
              <li
                key={t.id}
                className="hover:bg-accent group flex items-center gap-2 rounded-lg px-1.5 py-1.5"
              >
                <button
                  onClick={() => toggle(t.id)}
                  aria-label={t.done ? "Mark not done" : "Mark done"}
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
                    t.done
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-input",
                  )}
                >
                  {t.done && (
                    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
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
                  onClick={() => remove(t.id)}
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
