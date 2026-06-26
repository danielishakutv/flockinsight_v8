"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveBanner, deleteBanner, type BannerInput } from "@/app/superadmin/banners/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type BannerRow = {
  id: string;
  title: string;
  imageUrl: string | null;
  linkUrl: string | null;
  placement: string;
  active: boolean;
  sortOrder: number;
};

type FormState = {
  id?: string;
  title: string;
  imageUrl: string;
  linkUrl: string;
  placement: "directory" | "events" | "both";
  active: boolean;
  sortOrder: number;
};

const empty: FormState = {
  title: "",
  imageUrl: "",
  linkUrl: "",
  placement: "both",
  active: true,
  sortOrder: 0,
};

export function BannerManager({ banners }: { banners: BannerRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<FormState>(empty);
  const set = (p: Partial<FormState>) => setF((s) => ({ ...s, ...p }));

  function openNew() {
    setF(empty);
    setOpen(true);
  }
  function openEdit(b: BannerRow) {
    setF({
      id: b.id,
      title: b.title,
      imageUrl: b.imageUrl ?? "",
      linkUrl: b.linkUrl ?? "",
      placement: b.placement as FormState["placement"],
      active: b.active,
      sortOrder: b.sortOrder,
    });
    setOpen(true);
  }
  function save() {
    start(async () => {
      const res = await saveBanner(f as BannerInput);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Banner saved");
      setOpen(false);
      router.refresh();
    });
  }
  function remove(b: BannerRow) {
    if (!confirm(`Delete "${b.title}"?`)) return;
    start(async () => {
      const res = await deleteBanner(b.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Banner deleted");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew}>
          <Plus className="size-4" /> New banner
        </Button>
      </div>

      {banners.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="text-muted-foreground py-10 text-center">
            No banners yet. Add promo/ad banners shown on the public directory &
            events pages.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {banners.map((b) => (
            <Card key={b.id}>
              <CardContent className="flex flex-wrap items-center gap-3 py-3">
                {b.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.imageUrl} alt="" className="h-12 w-24 shrink-0 rounded object-cover" />
                ) : (
                  <div className="bg-muted grid h-12 w-24 shrink-0 place-items-center rounded">
                    <ImageIcon className="text-muted-foreground size-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{b.title}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {b.placement} · {b.linkUrl || "no link"}
                  </p>
                </div>
                <Badge variant={b.active ? "success" : "secondary"}>
                  {b.active ? "Active" : "Off"}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => openEdit(b)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(b)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{f.id ? "Edit banner" : "New banner"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="b-title">Title</Label>
              <Input id="b-title" value={f.title} onChange={(e) => set({ title: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-image">Image URL</Label>
              <Input
                id="b-image"
                value={f.imageUrl}
                onChange={(e) => set({ imageUrl: e.target.value })}
                placeholder="https://… (wide image, e.g. 1200×300)"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-link">Link URL</Label>
              <Input
                id="b-link"
                value={f.linkUrl}
                onChange={(e) => set({ linkUrl: e.target.value })}
                placeholder="https://… where it should go"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-2">
                <Label>Placement</Label>
                <Select value={f.placement} onValueChange={(v) => set({ placement: v as FormState["placement"] })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Both</SelectItem>
                    <SelectItem value="directory">Directory</SelectItem>
                    <SelectItem value="events">Events</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-order">Order</Label>
                <Input
                  id="b-order"
                  type="number"
                  value={f.sortOrder}
                  onChange={(e) => set({ sortOrder: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Active</Label>
                <Select value={f.active ? "yes" : "no"} onValueChange={(v) => set({ active: v === "yes" })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !f.title.trim()}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
