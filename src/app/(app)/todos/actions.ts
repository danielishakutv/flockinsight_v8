"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { todo } from "@/db/schema";
import { requireUser } from "@/lib/session";

export type TodoRow = { id: string; text: string; done: boolean };

export type AddResult =
  | { ok: true; todo: TodoRow }
  | { ok: false; error: string };
export type ActionResult = { ok: true } | { ok: false; error: string };

export async function addTodo(text: string): Promise<AddResult> {
  const t = (text ?? "").trim().slice(0, 300);
  if (!t) return { ok: false, error: "Task is empty." };
  const data = await requireUser();
  const [row] = await db
    .insert(todo)
    .values({ userId: data.user.id, text: t })
    .returning({ id: todo.id, text: todo.text, done: todo.done });
  return { ok: true, todo: row };
}

export async function toggleTodo(
  id: string,
  done: boolean,
): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  const data = await requireUser();
  await db
    .update(todo)
    .set({ done })
    .where(and(eq(todo.id, id), eq(todo.userId, data.user.id)));
  return { ok: true };
}

export async function deleteTodo(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  const data = await requireUser();
  // User removing their own task (scoped by userId).
  await db
    .delete(todo)
    .where(and(eq(todo.id, id), eq(todo.userId, data.user.id)));
  return { ok: true };
}
