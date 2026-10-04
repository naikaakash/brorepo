import { useCallback, useEffect, useRef, useState } from "react";
import { BriefcaseBusiness, FileCheck2, Fingerprint, House, LogOut, Menu, MessagesSquare, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { capabilitySchema, workspaceSchema, z } from "@applymate/contracts";
import type { Workspace } from "@applymate/contracts";
import { api, cancelled, successSchema } from "./api";
import { Auth } from "./Auth";
import { Dashboard } from "./Dashboard";
import { ProfilePage, VoicePage } from "./Candidate";
import { ApplicationsPage, JobsPage, StudioPage } from "./Workspace";
import { AnswersPage, PreferencesPage, SettingsPage } from "./Settings";
import { Badge, Brand, Button, Notice } from "./ui";
import { useAction } from "./hooks";
import type { PageProps } from "./ui";

const sessionSchema = z.object({ user: z.object({ id: z.string(), email: z.email(), name: z.string() }).nullable(), authenticated: z.boolean().optional() });
const navigation = [
  { id: "overview", label: "Overview", icon: House, group: "YOUR WORKSPACE" },
  { id: "jobs", label: "Opportunities", icon: Search },
  { id: "studio", label: "Document studio", icon: FileCheck2 },
  { id: "applications", label: "Applications", icon: BriefcaseBusiness },
  { id: "profile", label: "Candidate profile", icon: Fingerprint, group: "WHAT MAKES YOU, YOU" },
  { id: "voice", label: "Your voice", icon: Sparkles },
  { id: "answers", label: "Answer library", icon: MessagesSquare },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "settings", label: "Settings & privacy", icon: Settings2 }
];
const currentPath = () => window.location.hash.slice(1) || "overview";

export default function App() {
  const [data, setData] = useState<Workspace | null>(null);
  const [capabilities, setCapabilities] = useState<z.infer<typeof capabilitySchema> | null>(null);
  const [microsoftAuthenticated, setMicrosoftAuthenticated] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");
  const [boot, setBoot] = useState(0);
  const [path, setPath] = useState(currentPath);
  const [menu, setMenu] = useState(false);
  const account = useAction();
  const workspaceSequence = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++workspaceSequence.current;
    try {
      const workspace = await api.request("/workspace", workspaceSchema, { signal });
      if (sequence === workspaceSequence.current) setData(workspace);
    } catch (failure) {
      if (sequence !== workspaceSequence.current) throw new DOMException("Superseded workspace refresh.", "AbortError");
      throw failure;
    }
  }, []);
  const navigate = useCallback((next: string) => { window.location.hash = next; }, []);
  useEffect(() => {
    if (import.meta.env.VITE_PUBLIC_PREVIEW === "true") return;
    let active = true;
    api.onUnauthorized = () => {
      api.reset(); setData(null); setMicrosoftAuthenticated(false); setError("Your session expired. Sign in again to continue.");
    };
    async function start() {
      try {
        const [config, session] = await Promise.all([api.request("/capabilities", capabilitySchema), api.request("/session", sessionSchema)]);
        if (!active) return;
        setCapabilities(config);
        setMicrosoftAuthenticated(session.authenticated === true);
        if (session.user) await refresh();
      } catch (failure) { if (active && !cancelled(failure)) setError(failure instanceof Error ? failure.message : "The local server is unavailable."); }
      finally { if (active) setBooting(false); }
    }
    void start();
    return () => { active = false; api.onUnauthorized = null; api.reset(); };
  }, [boot, refresh]);
  const userId = data?.user.id;
  useEffect(() => {
    const changed = () => { setPath(currentPath()); setMenu(false); };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    if (!userId) return;
    document.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    const controller = new AbortController();
    void refresh(controller.signal).catch((failure: unknown) => {
      if (!cancelled(failure)) setError(failure instanceof Error ? failure.message : "Could not refresh the workspace.");
    });
    return () => controller.abort();
  }, [path, userId, refresh]);
  async function signOut() {
    if (capabilities?.mailMode === "microsoft") {
      window.location.assign("/.auth/logout?post_logout_redirect_uri=/");
      return;
    }
    await api.request("/auth/sign-out", successSchema, { method: "POST", body: {} });
    api.reset(); setData(null); setError(""); setMenu(false); navigate("welcome");
  }
  if (import.meta.env.VITE_PUBLIC_PREVIEW === "true") return <Auth publicPreview mailMode="local" signedIn={async () => { throw new Error("Authentication is unavailable in the public frontend preview."); }} />;
  if (booting) return <div className="boot-screen"><Brand /><p role="status">Opening ApplyMate...</p></div>;
  if (!capabilities) return <div className="boot-screen"><Brand /><Notice tone="error">{error || "The local API is unavailable."}</Notice><Button className="primary" onClick={() => { setBooting(true); setError(""); setBoot((value) => value + 1); }}>Try again</Button></div>;
  if (!data) return <>{error && <div className="landing-alert"><Notice tone="warning">{error}</Notice></div>}<Auth mailMode={capabilities.mailMode} microsoftAuthenticated={microsoftAuthenticated} signedIn={async () => { setError(""); await refresh(); navigate("overview"); }} /></>;
  const [section, id] = path.split("/");
  const props: PageProps = { data, refresh, navigate };
  let page;
  switch (section) {
    case "profile": page = <ProfilePage {...props} key={data.profile.id} />; break;
    case "voice": page = <VoicePage {...props} />; break;
    case "jobs": page = <JobsPage {...props} selectedId={id} />; break;
    case "studio": page = <StudioPage {...props} selectedId={id} />; break;
    case "applications": page = <ApplicationsPage {...props} selectedId={id} />; break;
    case "answers": page = <AnswersPage {...props} />; break;
    case "preferences": page = <PreferencesPage {...props} />; break;
    case "settings": page = <SettingsPage {...props} deleted={() => { api.reset(); setData(null); navigate("welcome"); }} />; break;
    default: page = <Dashboard {...props} />;
  }
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
    <aside className={`sidebar ${menu ? "is-open" : ""}`} aria-label="Workspace navigation">
      <a className="sidebar-brand" href="#overview" aria-label="ApplyMate overview"><Brand /></a>
      <nav>{navigation.map(({ id: item, label, icon: Icon, group }) => <div key={item}>{group && <p className="nav-group">{group}</p>}<a href={`#${item}`} className={`nav-link ${section === item || (item === "overview" && !navigation.some((entry) => entry.id === section)) ? "active" : ""}`} aria-current={section === item ? "page" : undefined}><Icon size={19} aria-hidden="true" />{label}{item === "applications" && data.applications.length > 0 && <span className="nav-count">{data.applications.length}</span>}</a></div>)}</nav>
      <div className="sidebar-bottom"><div className="local-status"><ShieldCheck size={20} aria-hidden="true" /><div><strong>{data.capabilities.localOnly ? "Local & in your control" : "Your private workspace"}</strong><p>{data.capabilities.localOnly ? "No cloud deployment" : "Microsoft sign-in · Public test"}</p></div></div>
        <div className="account-row"><span className="avatar">{(data.profile.fields.fullName.value || data.user.email).slice(0, 1).toUpperCase()}</span><div><strong>{data.profile.fields.fullName.value || "Your workspace"}</strong><span title={data.user.email}>{data.user.email}</span></div></div>
        <Button className="text-button signout" loading={account.busy} onClick={() => { void account.run(signOut); }}><LogOut size={16} aria-hidden="true" /> Sign out</Button>
      </div>
    </aside>
    <div className="workspace-main">
      <header className="topbar"><div><Button className="menu-toggle icon-button" aria-label={menu ? "Close navigation" : "Open navigation"} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}</Button><span className="topbar-title">Your next chapter</span><span className="topbar-divider">/</span><span>{navigation.find((item) => item.id === section)?.label ?? "Overview"}</span></div><Badge tone="purple"><span className="status-dot" /> Personal preview</Badge></header>
      <main id="main-content" tabIndex={-1}>
        {error && <Notice tone="error">{error}<Button className="text-button" onClick={() => { void account.run(async () => { await refresh(); setError(""); }); }}>Refresh workspace</Button></Notice>}
        {account.feedback}{page}
        <footer className="workspace-footer"><Brand /><span>Your facts. Your voice. Your final say.</span><span>{data.capabilities.localOnly ? "Local milestone" : "Private online pilot"} &middot; Review mode only</span></footer>
      </main>
    </div>
  </div>;
}
