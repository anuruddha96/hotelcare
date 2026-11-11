import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface AssistantProject {
  id: string;
  name: string;
  /** Standing preferences the assistant applies to every chat in the project. */
  instructions: string;
  updated_at: string;
}

const db = supabase as any;

/** The signed-in user's assistant projects. Private to the user. */
export function useAssistantProjects() {
  const { user, profile } = useAuth();
  const [projects, setProjects] = useState<AssistantProject[]>([]);
  // False until the workspace migration exists; the sidebar then hides projects
  // instead of showing a section that cannot save.
  const [available, setAvailable] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await db
      .from("assistant_projects")
      .select("id,name,instructions,updated_at")
      .eq("user_id", user.id)
      .order("name");
    if (error) {
      setAvailable(false);
      return;
    }
    setAvailable(true);
    setProjects((data ?? []) as AssistantProject[]);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load, profile?.organization_slug]);

  const createProject = useCallback(
    async (name: string, instructions = ""): Promise<AssistantProject | null> => {
      if (!user) return null;
      const clean = name.replace(/\s+/g, " ").trim().slice(0, 80);
      if (!clean) return null;
      const { data, error } = await db
        .from("assistant_projects")
        .insert({ user_id: user.id, name: clean, instructions: instructions.trim().slice(0, 4000) })
        .select("id,name,instructions,updated_at")
        .single();
      if (error || !data) {
        console.error("assistant: could not create project", error);
        return null;
      }
      setProjects((list) => [...list, data as AssistantProject].sort((a, b) => a.name.localeCompare(b.name)));
      return data as AssistantProject;
    },
    [user],
  );

  const updateProject = useCallback(
    async (id: string, patch: { name?: string; instructions?: string }) => {
      const next: Record<string, string> = {};
      if (patch.name !== undefined) {
        const clean = patch.name.replace(/\s+/g, " ").trim().slice(0, 80);
        if (!clean) return false;
        next.name = clean;
      }
      if (patch.instructions !== undefined) next.instructions = patch.instructions.trim().slice(0, 4000);
      const { error } = await db.from("assistant_projects").update(next).eq("id", id).eq("user_id", user?.id ?? "");
      if (error) {
        console.error("assistant: could not update project", error);
        return false;
      }
      setProjects((list) => list.map((p) => (p.id === id ? { ...p, ...next } : p)).sort((a, b) => a.name.localeCompare(b.name)));
      return true;
    },
    [user?.id],
  );

  /** Conversations of a deleted project are kept and return to the main list. */
  const deleteProject = useCallback(
    async (id: string) => {
      const { error } = await db.from("assistant_projects").delete().eq("id", id).eq("user_id", user?.id ?? "");
      if (error) return false;
      setProjects((list) => list.filter((p) => p.id !== id));
      return true;
    },
    [user?.id],
  );

  return { projects, projectsAvailable: available, createProject, updateProject, deleteProject, reloadProjects: load };
}
