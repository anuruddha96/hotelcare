import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Folder, MessageSquare, PanelLeft, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { searchAssistantThreads, useAssistant, type AssistantSearchHit, type AssistantThread } from "@/hooks/useAssistant";
import { useAssistantProjects, type AssistantProject } from "@/hooks/useAssistantProjects";
import AssistantChat from "@/components/assistant/AssistantChat";
import AssistantSidebar from "@/components/assistant/AssistantSidebar";
import AssistantAccessRequests, { canApproveAssistantAccess } from "@/components/assistant/AssistantAccessRequests";
import ReportProblemDialog from "@/components/assistant/ReportProblemDialog";
import MailboxesDialog from "@/components/assistant/MailboxesDialog";
import { canConnectMailbox } from "@/lib/assistant/mail";
import { canUseAssistant } from "@/lib/assistantAccess";
import {
  forgetActiveAssistantThread,
  getRememberedAssistantThread,
  rememberActiveAssistantThread,
} from "@/lib/assistant/activeThread";

const SIDEBAR_KEY = "hc-assistant-sidebar";

type ProjectDraft = { id: string | null; name: string; instructions: string };

/** The HotelCare AI workspace. Every conversation has its own URL. */
export default function AssistantPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    threads,
    loadingThreads,
    createThread,
    renameThread,
    deleteThread,
    loadThreads,
    setThreadPinned,
    setThreadFollowUpStatus,
    markThreadRead,
    moveThreadToProject,
  } = useAssistant(threadId ?? null);
  const { projects, projectsAvailable, createProject, updateProject, deleteProject } = useAssistantProjects();

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  const [mobileNav, setMobileNav] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchHits, setSearchHits] = useState<AssistantSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [renaming, setRenaming] = useState<{ thread: AssistantThread; title: string } | null>(null);
  const [deletingThread, setDeletingThread] = useState<AssistantThread | null>(null);
  const [deletingProject, setDeletingProject] = useState<AssistantProject | null>(null);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  // Remembers which chat asked for "New project" so it can be filed there.
  const moveAfterCreate = useRef<string | null>(null);
  // Set when the user deliberately opens a blank chat, so the "resume the last
  // conversation" redirect does not pull them straight back.
  const wantsBlank = useRef(false);

  const base = `/${profile?.organization_slug}/assistant`;
  const userId = user?.id ?? null;
  const organizationSlug = profile?.organization_slug ?? null;
  const activeThread = threads.find((t) => t.id === threadId) ?? null;
  const activeProject = projects.find((p) => p.id === activeThread?.project_id) ?? null;
  const requestedPrompt = (location.state as { miraPrompt?: { id: number; text: string } } | null)?.miraPrompt ?? null;

  useEffect(() => {
    document.title = activeThread?.title && activeThread.title !== "New chat" ? `${activeThread.title} · Mira by HotelCare` : "Mira by HotelCare";
  }, [activeThread?.title]);

  useEffect(() => {
    if (!userId || !organizationSlug) return;
    if (threadId) {
      rememberActiveAssistantThread(userId, organizationSlug, threadId);
      return;
    }
    if (wantsBlank.current) return;
    const remembered = getRememberedAssistantThread(userId, organizationSlug);
    if (remembered) navigate(`${base}/${remembered}`, { replace: true });
  }, [base, navigate, organizationSlug, threadId, userId]);

  // Back from the Google / Microsoft sign-in.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("mail");
    if (!result) return;
    const reason = params.get("reason");
    if (result === "connected") toast.success("Mailbox connected. Ask me about your inbox.");
    else
      toast.error(
        reason === "missing_permissions"
          ? "The mailbox was not connected: reading and sending permission is needed."
          : reason === "access_denied"
            ? "The mailbox sign-in was cancelled."
            : "The mailbox could not be connected.",
      );
    params.delete("mail");
    params.delete("reason");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    setMailOpen(true);
  }, []);

  const allowed = canUseAssistant(profile);
  useEffect(() => {
    if (profile && !allowed) navigate(`/${profile.organization_slug ?? ""}`, { replace: true });
  }, [profile, allowed, navigate]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced search over the user's own titles and messages.
  useEffect(() => {
    if (!searchOpen || !userId) return;
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const hits = await searchAssistantThreads(userId, term).catch(() => []);
      if (!cancelled) {
        setSearchHits(hits);
        setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchOpen, searchTerm, userId]);

  const toggleSidebar = (open: boolean) => {
    setSidebarOpen(open);
    try {
      localStorage.setItem(SIDEBAR_KEY, open ? "open" : "closed");
    } catch {
      // Preference only.
    }
  };

  const openThread = useCallback(
    (id: string) => {
      rememberActiveAssistantThread(userId, organizationSlug, id);
      setMobileNav(false);
      setSearchOpen(false);
      navigate(`${base}/${id}`);
    },
    [base, navigate, organizationSlug, userId],
  );

  /** A plain new chat is only created once the first message is sent. */
  const startBlank = () => {
    wantsBlank.current = true;
    forgetActiveAssistantThread(userId, organizationSlug);
    setMobileNav(false);
    navigate(base);
  };

  const newThread = async (projectId?: string) => {
    const id = await createThread(projectId);
    if (id) {
      rememberActiveAssistantThread(userId, organizationSlug, id);
      navigate(`${base}/${id}`);
    } else if (projectId) {
      toast.error("Could not start a chat in this project");
    }
    return id;
  };

  const newChat = (projectId?: string) => {
    if (projectId) {
      setMobileNav(false);
      void newThread(projectId);
    } else startBlank();
  };

  const markThreadActive = () => {
    if (threadId) rememberActiveAssistantThread(userId, organizationSlug, threadId);
    void loadThreads();
  };

  const saveProject = async () => {
    if (!projectDraft || savingProject) return;
    if (!projectDraft.name.trim()) {
      toast.error("Give the project a name");
      return;
    }
    setSavingProject(true);
    try {
      if (projectDraft.id) {
        const ok = await updateProject(projectDraft.id, { name: projectDraft.name, instructions: projectDraft.instructions });
        if (!ok) return void toast.error("Could not save the project");
      } else {
        const created = await createProject(projectDraft.name, projectDraft.instructions);
        if (!created) return void toast.error("Could not create the project");
        if (moveAfterCreate.current) await moveThreadToProject(moveAfterCreate.current, created.id);
      }
      moveAfterCreate.current = null;
      setProjectDraft(null);
    } finally {
      setSavingProject(false);
    }
  };

  const recentForSearch = useMemo(() => threads.slice(0, 8), [threads]);
  if (!allowed) return null;

  const sidebar = (onCollapse?: () => void) => (
    <AssistantSidebar
      threads={threads}
      loading={loadingThreads}
      activeThreadId={threadId ?? null}
      projects={projects}
      projectsAvailable={projectsAvailable}
      userName={profile?.full_name || profile?.nickname || user?.email || "You"}
      userRole={profile?.role ?? ""}
      canSeeInsights={profile?.role === "admin" || Boolean(profile?.role?.startsWith("top_management"))}
      canUseMail={canConnectMailbox(profile?.role)}
      onOpenMailboxes={() => {
        setMobileNav(false);
        setMailOpen(true);
      }}
      onNewChat={newChat}
      onOpenThread={openThread}
      onSearch={() => {
        setMobileNav(false);
        setSearchTerm("");
        setSearchOpen(true);
      }}
      onRenameThread={(thread) => setRenaming({ thread, title: thread.title })}
      onDeleteThread={setDeletingThread}
      onPinThread={async (thread, pinned) => {
        if (!(await setThreadPinned(thread.id, pinned))) toast.error("Could not update the pin");
      }}
      onFollowUp={async (thread, status) => {
        if (!(await setThreadFollowUpStatus(thread.id, status))) toast.error("Could not update follow-up status");
      }}
      onMoveThread={async (thread, projectId) => {
        if (!(await moveThreadToProject(thread.id, projectId))) toast.error("Could not move the chat");
      }}
      onNewProject={() => {
        moveAfterCreate.current = null;
        setProjectDraft({ id: null, name: "", instructions: "" });
      }}
      onEditProject={(project) => setProjectDraft({ id: project.id, name: project.name, instructions: project.instructions })}
      onDeleteProject={setDeletingProject}
      onOpenInsights={() => navigate(`/${profile?.organization_slug}/assistant-insights`)}
      onReport={() => setReportOpen(true)}
      onBack={() => navigate(`/${profile?.organization_slug ?? ""}`)}
      onCollapse={onCollapse}
    />
  );

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      {sidebarOpen && <aside className="hidden w-72 shrink-0 border-r md:block">{sidebar(() => toggleSidebar(false))}</aside>}

      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left" className="w-[86vw] max-w-xs p-0 [&>button]:hidden">
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          <SheetDescription className="sr-only">Your chats, projects and search</SheetDescription>
          {sidebar()}
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-1 border-b bg-background/95 px-2 backdrop-blur-xl sm:px-4">
          <Button size="icon" variant="ghost" className="h-9 w-9 md:hidden" aria-label="Open conversations" onClick={() => setMobileNav(true)}>
            <PanelLeft className="h-4 w-4" />
          </Button>
          {!sidebarOpen && (
            <Button size="icon" variant="ghost" className="hidden h-9 w-9 md:inline-flex" aria-label="Show sidebar" onClick={() => toggleSidebar(true)}>
              <PanelLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-sm font-semibold leading-5">
                <span>Mira</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">AI Operator</span>
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {activeProject ? `${activeProject.name} · ` : ""}
                {activeThread?.title && activeThread.title !== "New chat" ? activeThread.title : "Ask, decide, and get things done"}
              </p>
            </div>
          </div>
          {canApproveAssistantAccess(profile?.role) && (
            <Button size="sm" variant="ghost" className="hidden text-xs sm:inline-flex" onClick={() => setRequestsOpen(true)}>Requests</Button>
          )}
          <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="New chat" onClick={startBlank}>
            <Plus className="h-4 w-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 px-1 pb-1 sm:px-4">
          <AssistantChat
            workspace
            threadId={threadId ?? null}
            onNeedThread={() => newThread()}
            onThreadUpdated={markThreadActive}
            onReplyViewed={(at) => { if (threadId) void markThreadRead(threadId, at); }}
            suggestedPrompt={requestedPrompt}
            onSuggestedPromptConsumed={() => navigate(location.pathname + location.search, { replace: true, state: null })}
          />
        </div>
      </main>

      <Dialog open={requestsOpen} onOpenChange={setRequestsOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Team access requests</DialogTitle>
            <DialogDescription>Review temporary access requests for Mira.</DialogDescription></DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto"><AssistantAccessRequests /></div>
        </DialogContent>
      </Dialog>

      {/* Search ----------------------------------------------------------- */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="overflow-hidden p-0 shadow-lg sm:max-w-xl">
        <DialogTitle className="sr-only">Search chats</DialogTitle>
        <DialogDescription className="sr-only">Search your conversations by title or content</DialogDescription>
        {/* Results come from the server, so the built-in client filter is off. */}
        <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5">
        <CommandInput placeholder="Search your chats…" value={searchTerm} onValueChange={setSearchTerm} />
        <CommandList>
          {searchTerm.trim().length >= 2 ? (
            <>
              {!searching && <CommandEmpty>No chats match “{searchTerm.trim()}”.</CommandEmpty>}
              {searching && searchHits.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Searching…</p>}
              {searchHits.length > 0 && (
                <CommandGroup heading="Results">
                  {searchHits.map((hit) => (
                    <CommandItem key={hit.threadId} value={hit.threadId} onSelect={() => openThread(hit.threadId)} className="items-start gap-2">
                      <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{hit.title}</span>
                        {hit.snippet && <span className="block truncate text-xs text-muted-foreground">{hit.snippet}</span>}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </>
          ) : (
            <CommandGroup heading="Recent">
              <CommandItem
                value="new-chat"
                onSelect={() => {
                  setSearchOpen(false);
                  startBlank();
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> New chat
              </CommandItem>
              {recentForSearch.map((thread) => (
                <CommandItem key={thread.id} value={thread.id} onSelect={() => openThread(thread.id)}>
                  <MessageSquare className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{thread.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
        </Command>
        </DialogContent>
      </Dialog>

      {/* Rename ----------------------------------------------------------- */}
      <Dialog open={Boolean(renaming)} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>The new name is shown in your history only.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!renaming) return;
              if (await renameThread(renaming.thread.id, renaming.title)) setRenaming(null);
              else toast.error("Could not rename the chat");
            }}
          >
            <Input
              autoFocus
              maxLength={60}
              aria-label="Chat name"
              value={renaming?.title ?? ""}
              onChange={(event) => setRenaming((state) => (state ? { ...state, title: event.target.value } : state))}
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!renaming?.title.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Project ---------------------------------------------------------- */}
      <Dialog open={Boolean(projectDraft)} onOpenChange={(open) => !open && setProjectDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{projectDraft?.id ? "Project settings" : "New project"}</DialogTitle>
            <DialogDescription>
              A project keeps related chats together. Its instructions apply to every chat inside it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="assistant-project-name">Name</Label>
              <Input
                id="assistant-project-name"
                autoFocus
                maxLength={80}
                placeholder="December pricing"
                value={projectDraft?.name ?? ""}
                onChange={(event) => setProjectDraft((draft) => (draft ? { ...draft, name: event.target.value } : draft))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assistant-project-instructions">Instructions (optional)</Label>
              <Textarea
                id="assistant-project-instructions"
                rows={5}
                maxLength={4000}
                placeholder="Always answer for Hotel Memories. Compare with the same weekday last year and include a chart."
                value={projectDraft?.instructions ?? ""}
                onChange={(event) => setProjectDraft((draft) => (draft ? { ...draft, instructions: event.target.value } : draft))}
              />
              <p className="text-xs text-muted-foreground">
                Instructions shape focus and format. They never change what your role is allowed to see or do.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setProjectDraft(null)}>
              Cancel
            </Button>
            <Button disabled={savingProject || !projectDraft?.name.trim()} onClick={() => void saveProject()}>
              {projectDraft?.id ? "Save" : "Create project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmations --------------------------------------------- */}
      <AlertDialog open={Boolean(deletingThread)} onOpenChange={(open) => !open && setDeletingThread(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deletingThread?.title}” and its messages will be removed from your history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep chat</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                const target = deletingThread;
                setDeletingThread(null);
                if (!target) return;
                if (!(await deleteThread(target.id))) return void toast.error("Could not delete the chat");
                if (target.id === threadId) startBlank();
              }}
            >
              Delete chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(deletingProject)} onOpenChange={(open) => !open && setDeletingProject(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deletingProject?.name}” and its instructions will be deleted. The chats inside are kept and move back to your main list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep project</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                const target = deletingProject;
                setDeletingProject(null);
                if (!target) return;
                if (!(await deleteProject(target.id))) return void toast.error("Could not delete the project");
                void loadThreads();
              }}
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MailboxesDialog open={mailOpen} onOpenChange={setMailOpen} />
      <ReportProblemDialog open={reportOpen} onOpenChange={setReportOpen} threadId={threadId ?? null} />
    </div>
  );
}
