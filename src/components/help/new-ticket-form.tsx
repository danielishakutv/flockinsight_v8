"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { createTicket } from "@/app/(app)/help/support/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/components/i18n-provider";

export function NewTicketForm({
  categories,
}: {
  categories: { value: string; label: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState(categories[0]?.value ?? "general");
  const [message, setMessage] = useState("");

  function submit() {
    start(async () => {
      const res = await createTicket({ subject, category, message });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("help.sentWeLlReplyBy"));
      router.push(`/help/support/${res.id}`);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("help.sendUsAMessage")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="subject">{t("help.subject")}</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("help.whatDoYouNeedHelp")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category">{t("help.category")}</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="message">{t("help.message")}</Label>
          <Textarea
            id="message"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("help.describeYourIssueOrQuestion")}
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send message
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
