import { useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  ChevronRight,
  CheckCircle2,
  CircleDot,
  Flag,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Mail,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { AssistantThread } from "@/hooks/useAssistant";
import { hasUnreadAssistantReply, isOpenFollowUp } from "@/lib/assistant/threadState";
import type { AssistantProject } from "@/hooks/useAssistantProjects";
import { cn } from "@/lib/utils";
import hotelCareMark from "@/assets/hotelcare-logo-mark.png";

/** Buckets the history the way people look for a chat: by how recent it is. */
export function groupThreadsByRecency(threads: AssistantThread[], now: Date = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const groups: { label: string; threads: AssistantThread[] }[] = [
    { label: "Today", threads: [] },
    { label: "Yesterday", threads: [] },
    { label: "Previous 7 days", threads: [] },
    { label: "Older", threads: [] },
  ];
  for (const thread of threads) {
    const at = Date.parse(thread.updated_at);
    const index = at >= startOfToday ? 0 : at >= startOfToday - day ? 1 : at >= startOfToday - 7 * day ? 2 : 3;
    groups[index].threads.push(thread);
  }
  return groups.filter((group) => group.threads.length > 0);
}

export interface AssistantSidebarProps {
  threads: AssistantThread[];
  loading: boolean;
  activeThreadId: string | null;
  projects: AssistantProject[];
  projectsAvailable: boolean;
  userName: string;
  userRole: string;
  canSeeInsights: boolean;
  canUseMail: boolean;
  onOpenMailboxes: () => void;
  onNewChat: (projectId?: string) => void;
  onOpenThread: (id: string) => void;
  onSearch: () => void;
  onRenameThread: (thread: AssistantThread) => void;
  onDeleteThread: (thread: AssistantThread) => void;
  onPinThread: (thread: AssistantThread, pinned: boolean) => void;
  onFollowUp: (thread: AssistantThread, status: "none" | "open" | "done") => void;
  onMoveThread: (thread: AssistantThread, projectId: string | null) => void;
  onNewProject: () => void;
  onEditProject: (project: AssistantProject) => void;
  onDeleteProject: (project: AssistantProject) => void;
  onOpenInsights: () => void;
  onReport: () => void;
  onBack: () => void;
  onCollapse?: () => void;
}

export default function AssistantSidebar(props: AssistantSidebarProps) {
  const { threads, projects, activeThreadId } = props;
  const activeProject = threads.find((t) => t.id === activeThreadId)?.project_id ?? null;
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});

  const knownProjects = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);
  const inProject = (thread: AssistantThread) => Boolean(thread.project_id && knownProjects.has(thread.project_id));
  const pinned = useMemo(
    () => threads.filter((t) => t.pinned_at).sort((a, b) => String(b.pinned_at).localeCompare(String(a.pinned_at))),
    [threads],
  );
  const followUps = useMemo(() => threads.filter((t) => isOpenFollowUp(t) && !t.pinned_at && !inProject(t)), [threads, knownProjects]);
  const recents = useMemo(
    () => groupThreadsByRecency(threads.filter((t) => !t.pinned_at && !isOpenFollowUp(t) && !inProject(t))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threads, knownProjects],
  );

  const row = (thread: AssistantThread) => (
    <div
      key={thread.id}
      className={cn(
        "group/row relative flex items-center rounded-lg text-sm transition-colors",
        thread.id === activeThreadId ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60",
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 px-2.5 py-2 text-left"
        title={thread.title}
        aria-current={thread.id === activeThreadId ? "page" : undefined}
        aria-label={thread.title + (hasUnreadAssistantReply(thread) ? ", unread reply" : "") + (isOpenFollowUp(thread) ? ", needs follow-up" : "")}
        onClick={() => props.onOpenThread(thread.id)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{thread.title}</span>
          {isOpenFollowUp(thread) && <CircleDot aria-label="Needs follow-up" className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
          {thread.follow_up_status === "done" && <CheckCircle2 aria-label="Marked done" className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
          {hasUnreadAssistantReply(thread) && <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-label="Unread reply" />}
        </span>
        {thread.preview && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{thread.preview}</span>}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Options for ${thread.title}`}
            className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 md:opacity-0 md:group-hover/row:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem onClick={() => props.onPinThread(thread, !thread.pinned_at)}>
            {thread.pinned_at ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
            {thread.pinned_at ? "Unpin conversation" : "Pin important conversation"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => props.onFollowUp(thread, thread.follow_up_status === "open" ? "done" : "open")}>
            {thread.follow_up_status === "open" ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <CircleDot className="mr-2 h-4 w-4" />}
            {thread.follow_up_status === "open" ? "Mark task done" : thread.follow_up_status === "done" ? "Reopen follow-up" : "Needs follow-up"}
          </DropdownMenuItem>
          {Boolean(thread.follow_up_status && thread.follow_up_status !== "none") && (
            <DropdownMenuItem onClick={() => props.onFollowUp(thread, "none")}>Clear task status</DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => props.onRenameThread(thread)}>
            <Pencil className="mr-2 h-4 w-4" /> Rename
          </DropdownMenuItem>
          {props.projectsAvailable && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="mr-2 h-4 w-4" /> Move to project
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                {projects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    disabled={thread.project_id === project.id}
                    onClick={() => props.onMoveThread(thread, project.id)}
                  >
                    <Folder className="mr-2 h-4 w-4" />
                    <span className="truncate">{project.name}</span>
                  </DropdownMenuItem>
                ))}
                {projects.length > 0 && <DropdownMenuSeparator />}
                {inProject(thread) && (
                  <DropdownMenuItem onClick={() => props.onMoveThread(thread, null)}>Remove from project</DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={props.onNewProject}>
                  <FolderPlus className="mr-2 h-4 w-4" /> New project
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => props.onDeleteThread(thread)}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const heading = (label: string, action?: React.ReactNode) => (
    <div className="flex items-center justify-between px-2.5 pb-1 pt-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</h2>
      {action}
    </div>
  );

  return (
    <nav aria-label="Assistant conversations" className="flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <img src={hotelCareMark} alt="" className="h-8 w-8 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">Mira <span className="font-normal text-muted-foreground">by HotelCare</span></p>
          <p className="truncate text-[11px] text-muted-foreground">Your hotel operations companion</p>
        </div>
        {props.onCollapse && (
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Hide sidebar" onClick={props.onCollapse}>
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="space-y-1 px-2">
        <Button variant="outline" className="h-9 w-full justify-start gap-2 bg-background" onClick={() => props.onNewChat()}>
          <Plus className="h-4 w-4" /> New chat
        </Button>
        <Button variant="ghost" className="h-9 w-full justify-start gap-2 font-normal text-muted-foreground" onClick={props.onSearch}>
          <Search className="h-4 w-4" /> Search chats
          <kbd className="ml-auto hidden rounded border bg-background px-1.5 text-[10px] font-medium md:inline">Ctrl K</kbd>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {props.projectsAvailable && (
          <>
            {heading(
              "Projects",
              <button
                type="button"
                aria-label="New project"
                className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                onClick={props.onNewProject}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>,
            )}
            {projects.length === 0 && (
              <p className="px-2.5 pb-1 text-xs text-muted-foreground">
                Group chats by topic and give the assistant standing instructions.
              </p>
            )}
            {projects.map((project) => {
              const items = threads.filter((t) => t.project_id === project.id);
              const open = openProjects[project.id] ?? project.id === activeProject;
              return (
                <div key={project.id}>
                  <div className="group/row flex items-center rounded-lg text-sm hover:bg-sidebar-accent/60">
                    <button
                      type="button"
                      aria-expanded={open}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
                      onClick={() => setOpenProjects((state) => ({ ...state, [project.id]: !open }))}
                    >
                      <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
                      {open ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />}
                      <span className="truncate">{project.name}</span>
                      <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{items.length || ""}</span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Options for project ${project.name}`}
                          className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground data-[state=open]:opacity-100 md:opacity-0 md:group-hover/row:opacity-100"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-52">
                        <DropdownMenuItem onClick={() => props.onNewChat(project.id)}>
                          <Plus className="mr-2 h-4 w-4" /> New chat in project
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => props.onEditProject(project)}>
                          <Settings2 className="mr-2 h-4 w-4" /> Name and instructions
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => props.onDeleteProject(project)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete project
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {open && (
                    <div className="ml-4 border-l pl-1.5">
                      {items.map(row)}
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                        onClick={() => props.onNewChat(project.id)}
                      >
                        <Plus className="h-3.5 w-3.5" /> New chat
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {pinned.length > 0 && (
          <>
            {heading("Pinned")}
            {pinned.map(row)}
          </>
        )}

        {followUps.length > 0 && (
          <>
            {heading("Needs follow-up")}
            {followUps.map(row)}
          </>
        )}

        {props.loading && threads.length === 0 && (
          <div className="space-y-1.5 pt-4">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-8 w-full rounded-lg" />
            ))}
          </div>
        )}
        {recents.map((group) => (
          <div key={group.label}>
            {heading(group.label)}
            {group.threads.map(row)}
          </div>
        ))}
        {!props.loading && threads.length === 0 && (
          <p className="px-2.5 pt-6 text-xs text-muted-foreground">Your conversations will appear here.</p>
        )}
      </div>

      <div className="border-t px-2 py-2">
        {props.canUseMail && (
          <Button variant="ghost" className="h-8 w-full justify-start gap-2 text-xs font-normal" onClick={props.onOpenMailboxes}>
            <Mail className="h-3.5 w-3.5" /> Mailboxes
          </Button>
        )}
        {props.canSeeInsights && (
          <Button variant="ghost" className="h-8 w-full justify-start gap-2 text-xs font-normal" onClick={props.onOpenInsights}>
            <BarChart3 className="h-3.5 w-3.5" /> Usage and audit trail
          </Button>
        )}
        <Button variant="ghost" className="h-8 w-full justify-start gap-2 text-xs font-normal" onClick={props.onReport}>
          <Flag className="h-3.5 w-3.5" /> Report a problem
        </Button>
        <Button variant="ghost" className="h-8 w-full justify-start gap-2 text-xs font-normal" onClick={props.onBack}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Hotel Care
        </Button>
        <div className="mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {(props.userName.trim()[0] ?? "?").toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{props.userName}</p>
            <p className="truncate text-[11px] capitalize text-muted-foreground">{props.userRole.replaceAll("_", " ")}</p>
          </div>
        </div>
      </div>
    </nav>
  );
}
