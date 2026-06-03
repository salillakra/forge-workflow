"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Loader2, Building2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { orgsApi } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

const schema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(64),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(64)
    .regex(/^[a-z0-9]+$/, "Slug must be lowercase alphanumeric only"),
});
type FormData = z.infer<typeof schema>;

export default function NewOrgPage() {
  const router = useRouter();
  const setCurrentOrg = useAuthStore((s) => s.setCurrentOrg);
  const qc = useQueryClient();

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const createMutation = useMutation({
    mutationFn: orgsApi.create,
    onSuccess: (org) => {
      qc.invalidateQueries({ queryKey: ["orgs"] });
      setCurrentOrg(org);
      toast.success(`Workspace "${org.name}" created!`);
      router.push("/dashboard");
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to create workspace";
      toast.error(msg);
    },
  });

  // Auto-slug from name
  const name = watch("name");
  const autoSlug = name?.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32) ?? "";

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] flex items-center justify-center px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-125 h-125 bg-[hsl(var(--primary)/0.05)] rounded-full blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative"
      >
        <Link href="/dashboard" className="flex items-center gap-1 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] mb-6">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Link>

        <Card className="glass">
          <CardHeader>
            <div className="w-10 h-10 rounded-xl bg-[hsl(var(--accent))] flex items-center justify-center mb-3">
              <Building2 className="w-5 h-5 text-[hsl(var(--primary))]" />
            </div>
            <CardTitle className="text-xl font-bold">Create workspace</CardTitle>
            <CardDescription>
              A workspace holds your projects, workflows, and team members.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
              <div className="space-y-2">
                <Label>Workspace name</Label>
                <Input
                  placeholder="Acme Corp"
                  {...register("name")}
                  onChange={(e) => {
                    register("name").onChange(e);
                    setValue("slug", e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32));
                  }}
                />
                {errors.name && <p className="text-xs text-red-400">{errors.name.message}</p>}
              </div>

              <div className="space-y-2">
                <Label>Slug</Label>
                <div className="flex items-center rounded-md border border-[hsl(var(--border))] overflow-hidden bg-[hsl(var(--input))]">
                  <span className="px-3 text-xs text-[hsl(var(--muted-foreground))] border-r border-[hsl(var(--border))] py-2 shrink-0">
                    forge.dev/
                  </span>
                  <Input
                    className="border-0 bg-transparent focus-visible:ring-0"
                    placeholder="acme"
                    {...register("slug")}
                  />
                </div>
                {errors.slug && <p className="text-xs text-red-400">{errors.slug.message}</p>}
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  Lowercase letters and numbers only. Cannot be changed later.
                </p>
              </div>

              <Button
                type="submit"
                className="w-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] glow-primary"
                disabled={createMutation.isPending}
              >
                {createMutation.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</>
                  : "Create workspace"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
