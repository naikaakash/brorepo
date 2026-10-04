import { useState } from "react";
import { ArrowRight, Check, Download, KeyRound, LockKeyhole, Plus, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { answerInputSchema, answerSchema, connectionInputSchema, connectionSchema, preferenceSchema, z } from "@applymate/contracts";
import { api, microsoftSignOut, savedSchema } from "./api";
import { Badge, Button, Empty, Field, Notice, PageTitle } from "./ui";
import { date, phrases, useAction } from "./hooks";
import type { PageProps } from "./ui";

const preferencesInput = preferenceSchema.omit({ id: true, createdAt: true, updatedAt: true });
const removedSchema = z.object({ removed: z.literal(true) });
const deletedSchema = z.object({ deleted: z.literal(true) });
const microsoftLogin = "/.auth/login/aad?post_login_redirect_uri=" + encodeURIComponent("/#settings");
const microsoftReauthentication = "/.auth/logout?post_logout_redirect_uri=" + encodeURIComponent(microsoftLogin);

export function PreferencesPage({ data, refresh, navigate }: PageProps) {
  const [form, setForm] = useState(preferencesInput.parse(data.preferences));
  const [roles, setRoles] = useState(data.preferences.roles.join(", "));
  const [locations, setLocations] = useState(data.preferences.locations.join(", "));
  const [excluded, setExcluded] = useState(data.preferences.excludedCompanies.join(", "));
  const action = useAction();
  function patch<K extends keyof typeof form>(key: K, value: (typeof form)[K]) { setForm((previous) => ({ ...previous, [key]: value })); }
  return <>
    <PageTitle eyebrow="A SEARCH THAT FITS YOUR LIFE" title="Set your direction" description="Your preferences are boundaries, not suggestions. Roles that conflict cannot move into tailoring." />
    <form onSubmit={(event) => { event.preventDefault(); void action.run(async () => {
      await api.request("/preferences", savedSchema, { method: "PUT", body: { ...form, roles: phrases(roles), locations: phrases(locations), excludedCompanies: phrases(excluded), mode: "Review" } });
      await refresh(); if (data.profile.onboardingStep === "preferences") navigate("overview");
    }, "Your preferences are saved. Refresh existing job analyses to see the updated evidence map."); }}>
      <div className="settings-grid"><section className="card"><p className="eyebrow">WHAT A GOOD FIT LOOKS LIKE</p><h2>Opportunities worth your attention</h2>
        <Field label="Target roles" hint="Separate titles with commas. Leave blank to consider any role."><input maxLength={2000} value={roles} onChange={(event) => setRoles(event.target.value)} placeholder="Software Engineer, Frontend Engineer" /></Field>
        <Field label="Preferred locations" hint="Comma-separated. Listings without enough location information may be blocked."><input maxLength={2000} value={locations} onChange={(event) => setLocations(event.target.value)} placeholder="Seattle, Remote" /></Field>
        <Field label="Preferred work arrangement"><select value={form.workStyle} onChange={(event) => patch("workStyle", preferenceSchema.shape.workStyle.parse(event.target.value))}><option value="any">Any arrangement</option><option value="remote">Remote only</option><option value="hybrid">Hybrid only</option><option value="onsite">On-site only</option></select></Field>
        <div className="form-grid"><Field label="Minimum annual salary" hint="Optional. A listing needs a compatible stated range to pass."><input type="number" min={0} max={10000000} value={form.salaryMinimum ?? ""} onChange={(event) => patch("salaryMinimum", event.target.value ? Number(event.target.value) : null)} placeholder="No salary filter" /></Field>
          <Field label="Preferred currency"><select value={form.currency} onChange={(event) => patch("currency", preferenceSchema.shape.currency.parse(event.target.value))}>{preferenceSchema.shape.currency.options.map((currency) => <option key={currency}>{currency}</option>)}</select></Field></div>
        <Field label="Companies to exclude" hint="Comma-separated. Matching companies are blocked before generation."><textarea rows={2} maxLength={10000} value={excluded} onChange={(event) => setExcluded(event.target.value)} /></Field>
      </section><div className="stack"><section className="card"><span className="icon-tile"><ShieldCheck aria-hidden="true" /></span><h2>Always in your hands</h2><div className="mode-card selected"><div className="between"><strong>Review mode</strong><Badge tone="green"><Check size={12} aria-hidden="true" /> Active</Badge></div><p>You approve every exact version and handle every employer submission yourself.</p></div>
        <div className="mode-card unavailable"><strong>Hybrid &amp; Auto</strong><Badge>Not enabled</Badge><p>Automated employer actions need additional providers, controls, and release gates.</p></div>
        <Field label="Daily package limit" hint="A local safety cap per UTC day, including failed generation attempts."><input type="number" required min={1} max={20} step={1} value={form.dailyLimit} onChange={(event) => patch("dailyLimit", Number(event.target.value))} /></Field>
        <label className="check-row"><input type="checkbox" checked={form.notifications} onChange={(event) => patch("notifications", event.target.checked)} /><span>Show recent local activity on my overview</span></label>
      </section><Notice>These controls do not enable scraping, background browser sessions, emails, or automatic applications.</Notice></div></div>
      {action.feedback}<div className="save-bar"><span className="subtle">Changes are checked again before draft generation and approval.</span><Button type="submit" className="primary" loading={action.busy}>Save preferences <ArrowRight size={17} aria-hidden="true" /></Button></div>
    </form>
  </>;
}

export function AnswersPage({ data, refresh }: PageProps) {
  const [form, setForm] = useState<z.infer<typeof answerInputSchema>>({ question: "", answer: "", sensitivity: "standard", reuse: "ask" });
  const action = useAction();
  return <>
    <PageTitle eyebrow="THOUGHTFUL ANSWERS, LESS REPETITION" title="Your answer library" description="Keep confirmed answers to recurring questions. Versions travel with application snapshots, so past records never drift." />
    <div className="settings-grid"><section className="card"><div className="section-heading"><div><p className="eyebrow">IN YOUR OWN WORDS</p><h2>Confirm an answer</h2></div><Plus size={24} className="purple-ink" aria-hidden="true" /></div>
      <form onSubmit={(event) => { event.preventDefault(); void action.run(async () => {
        await api.request("/answers", answerSchema, { method: "POST", body: answerInputSchema.parse(form) });
        setForm({ question: "", answer: "", sensitivity: "standard", reuse: "ask" }); await refresh();
      }, "Answer confirmed. A repeated question gets a new version, not a silent overwrite."); }}>
        <Field label="Application question"><input required minLength={5} maxLength={500} value={form.question} onChange={(event) => setForm({ ...form, question: event.target.value })} placeholder="What interests you in this kind of work?" /></Field>
        <Field label="Your confirmed answer"><textarea required maxLength={5000} rows={6} value={form.answer} onChange={(event) => setForm({ ...form, answer: event.target.value })} /></Field>
        <div className="form-grid"><Field label="Answer sensitivity"><select value={form.sensitivity} onChange={(event) => {
          const sensitivity = answerInputSchema.shape.sensitivity.parse(event.target.value); setForm({ ...form, sensitivity, reuse: sensitivity === "sensitive" ? "ask" : form.reuse });
        }}><option value="standard">Standard</option><option value="sensitive">Sensitive - confirm every time</option></select></Field>
          <Field label="Reuse permission"><select value={form.reuse} onChange={(event) => setForm({ ...form, reuse: answerInputSchema.shape.reuse.parse(event.target.value) })}><option value="ask">Ask before reuse</option><option value="approved" disabled={form.sensitivity === "sensitive"}>Approved for future snapshots</option></select></Field></div>
        <p className="subtle">Sponsorship, compensation, identity, and other sensitive answers must be marked sensitive and confirmed every time. Nothing is sent to employers automatically.</p>
        {action.feedback}<Button className="primary" type="submit" loading={action.busy}><Check size={17} aria-hidden="true" /> Confirm & save answer</Button>
      </form>
    </section><section className="card"><div className="section-heading"><h2>Saved questions</h2><Badge>{data.answers.length}</Badge></div>{data.answers.length ? data.answers.map((answer) => {
      const latest = answer.versions.at(-1)!;
      return <article className="answer-card" key={answer.id}><div className="between"><Badge tone={latest.sensitivity === "sensitive" ? "amber" : "purple"}>{latest.sensitivity}</Badge><span className="subtle">Version {latest.version}</span></div><h3>{answer.question}</h3><p className="preserve-lines">{latest.answer}</p><div className="between"><span className="subtle">{latest.reuse === "approved" ? "Explicit reuse approval" : "Confirmation required"}</span><Button className="text-button small" onClick={() => setForm({ question: answer.question, answer: latest.answer, sensitivity: latest.sensitivity, reuse: latest.reuse })}>Revise answer</Button></div>
        {answer.versions.length > 1 && <details className="source-details"><summary>Earlier versions ({answer.versions.length - 1})</summary>{answer.versions.slice(0, -1).map((version) => <div key={version.version}><strong>Version {version.version} &middot; {date(version.confirmedAt)}</strong><p className="preserve-lines">{version.answer}</p></div>)}</details>}</article>;
    }) : <Empty title="Your answers belong to you.">Save a thoughtful answer once, then decide explicitly when it can be reused.</Empty>}</section></div>
  </>;
}

export function SettingsPage({ data, refresh, deleted }: PageProps & { deleted: () => void }) {
  const [provider, setProvider] = useState<"openai" | "gemini">("openai");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [consent, setConsent] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const action = useAction();
  const privacy = useAction();
  return <>
    <PageTitle eyebrow="CLEAR CONTROLS. NO SURPRISES." title="Settings & privacy" description="Understand where your data is saved, what could leave this workspace, and which capabilities are enabled." />
    <section className="card privacy-intro"><span className="icon-tile mint"><ShieldCheck size={28} aria-hidden="true" /></span><div><h2>{data.capabilities.localOnly ? "A personal, local workspace" : "Your private online workspace"}</h2><p>Signed in as <strong>{data.user.email}</strong>. Your resumes, candidate records, and provider keys are stored {data.capabilities.localOnly ? "on this computer" : "in your account's private Azure workspace"}. There are no analytics or external fonts.</p><p className="subtle">Candidate records and file/key payloads are encrypted. Core sign-in records, including email and session data, are database columns. {data.capabilities.localOnly ? "The local encryption key lives beside the database; this is not managed cloud security." : "The online encryption key is supplied through Azure Key Vault. This single-instance test is not a highly available commercial service."}</p></div><Badge tone="green">{data.capabilities.localOnly ? "Local only" : "Account-isolated"}</Badge></section>
    {action.feedback}
    <section className="card"><div className="section-heading"><div><p className="eyebrow">OPTIONAL, NEVER REQUIRED</p><h2>Your AI connections</h2><p>Everything works in evidence-only mode without an API key. Add your own provider only if you want model-assisted rewriting and a separate model review.</p></div><KeyRound size={27} className="purple-ink" aria-hidden="true" /></div>
      <div className="settings-grid"><form onSubmit={(event) => { event.preventDefault(); void action.run(async () => {
        await api.request("/connections", connectionSchema, { method: "POST", body: connectionInputSchema.parse({ provider, model, apiKey: key, consent }) });
        setKey(""); setConsent(false); await refresh();
      }, "Connection saved encrypted. Test it before choosing it for a draft."); }}>
        <div className="form-grid"><Field label="AI provider"><select value={provider} onChange={(event) => { setProvider(connectionSchema.shape.provider.parse(event.target.value)); setModel(""); }}><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option></select></Field>
          <Field label="Model ID" hint="Use a model your account can access with structured JSON output."><input required maxLength={120} pattern="[a-zA-Z0-9._/-]+" value={model} onChange={(event) => setModel(event.target.value)} placeholder="Your provider's model ID" spellCheck={false} /></Field></div>
        <Field label="Provider API key" hint="Never stored in browser local storage. Only the final four characters are shown after saving."><input type="password" required minLength={16} maxLength={500} autoComplete="off" spellCheck={false} value={key} onChange={(event) => setKey(event.target.value)} /></Field>
        <label className="check-row"><input type="checkbox" required checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I understand that testing and using this connection makes requests to the selected provider and may incur provider charges. When I choose it for a draft, my verified facts, writing samples, and job description leave this workspace.</span></label>
        <Button type="submit" className="primary" disabled={!consent} loading={action.busy}><LockKeyhole size={16} aria-hidden="true" /> Save encrypted connection</Button>
      </form><div><Notice tone="warning">Sensitive actions require a sign-in within the last five minutes. {data.capabilities.mailMode === "microsoft" ? <>Verify again, then retry. You will return to Settings; unsaved changes will be lost. No deletion happens automatically.<p><a className="button secondary" href={microsoftReauthentication} onClick={(event) => { event.preventDefault(); void action.run(() => microsoftSignOut(microsoftLogin)); }}><LockKeyhole size={16} aria-hidden="true" /> Verify Microsoft sign-in again</a></p></> : "If prompted, sign out and verify a new code before saving, testing, removing keys, or deleting your account."}</Notice>
        {data.connections.length ? <div className="connection-list">{data.connections.map((connection) => <article className="connection-card" key={connection.id}><div className="between"><strong>{connection.provider === "openai" ? "OpenAI" : "Gemini"}</strong><Badge tone={connection.status === "connected" ? "green" : connection.status === "failed" ? "red" : "amber"}>{connection.status}</Badge></div><p>{connection.model}</p><code>Key ending in {connection.suffix}</code><p className="subtle">{connection.testedAt ? `Last test ${date(connection.testedAt)}` : "Not tested. Cannot be selected for generation yet."}</p><div className="button-row">
          <Button className="secondary small" loading={action.busy} onClick={() => { void action.run(async () => {
            try { await api.request(`/connections/${connection.id}/test`, connectionSchema, { method: "POST", body: {} }); }
            finally { await refresh(); }
          }, "Connection test passed. This provider can now be selected on an opportunity."); }}>Test connection (provider call)</Button>
          <Button className="icon-button danger-text" aria-label={`Remove ${connection.provider} connection ${connection.model}`} loading={action.busy} onClick={() => { void action.run(async () => { await api.request(`/connections/${connection.id}`, removedSchema, { method: "DELETE", body: {} }); await refresh(); }, "Connection and encrypted key removed."); }}><Trash2 size={17} aria-hidden="true" /></Button>
        </div></article>)}</div> : <div className="local-engine"><Sparkles size={28} aria-hidden="true" /><h3>Evidence-only local</h3><p>No external model configured. Your facts stay here, and local drafting preserves their wording.</p><Badge tone="green">Available now</Badge></div>}
      </div></div>
    </section>
    <section className="card"><p className="eyebrow">WHAT IS ACTUALLY ENABLED</p><h2>No pretend integrations</h2><div className="capability-grid">
      <div><strong>{data.capabilities.mailMode === "microsoft" ? "Microsoft sign-in" : "Passwordless sign-in"}</strong><Badge tone={data.capabilities.mailMode === "local" ? "amber" : "green"}>{data.capabilities.mailMode === "local" ? "Local email preview" : data.capabilities.mailMode === "microsoft" ? "Azure platform authentication" : "SMTP delivery configured"}</Badge><p>{data.capabilities.mailMode === "local" ? "Codes appear in this app, not in an external inbox. Not production proof of email ownership." : data.capabilities.mailMode === "microsoft" ? "Azure validates Microsoft identity; the API checks authentication and record ownership. Local email-code endpoints are disabled." : "The configured SMTP service sends one-time codes. Delivery still depends on the provider."}</p></div>
      <div><strong>Managed inbox</strong><Badge>Not available</Badge><p>No mailbox integration, forwarding, or employer-email ingestion.</p></div>
      <div><strong>Employer automation</strong><Badge>Not available</Badge><p>No job-site passwords, background browser sessions, CAPTCHA handling, or automatic submission.</p></div>
      <div><strong>Subscriptions &amp; billing</strong><Badge>Not available</Badge><p>No plan purchase, payment integration, or ApplyMate billing. Optional AI calls are billed by your provider.</p></div>
    </div></section>
    <section className="card"><div className="section-heading"><div><p className="eyebrow">YOUR DATA, YOUR DECISION</p><h2>Take a copy. Or start fresh.</h2><p>Export your saved records as JSON. Original resume files can be downloaded from your candidate profile.</p></div><Download size={25} className="purple-ink" aria-hidden="true" /></div>
      {privacy.feedback}
      <Button className="secondary" loading={privacy.busy} onClick={() => { void privacy.run(() => api.download("/account/export", "applymate-data.json", "application/json")); }}><Download size={17} aria-hidden="true" /> Export my workspace data</Button><p className="subtle">Exports contain private profile information. Keep them safe. Provider keys and session tokens are not included.</p>
      <div className="danger-zone"><h3>Delete this {data.capabilities.localOnly ? "local " : ""}account</h3><p>This deletes the account, saved career records, originals, provider keys, and application records from the live database. It cannot erase previous downloads, external provider records, backups, or your Microsoft identity. Reopening a deleted online workspace requires acknowledging the data notice again.</p>{data.capabilities.mailMode === "microsoft" && <><p>Step 1: Verify your Microsoft sign-in. Step 2: Return here, type DELETE, and submit within five minutes.</p><p><a className="button primary" href={microsoftReauthentication} onClick={(event) => { event.preventDefault(); void privacy.run(() => microsoftSignOut(microsoftLogin)); }}><LockKeyhole size={16} aria-hidden="true" /> Verify Microsoft sign-in to delete</a></p></>}<form onSubmit={(event) => { event.preventDefault(); void privacy.run(async () => {
        await api.request("/account", deletedSchema, { method: "DELETE", body: { confirmation } }); deleted();
      }); }}><Field label="Type DELETE to confirm"><input required pattern="DELETE" value={confirmation} autoComplete="off" onChange={(event) => setConfirmation(event.target.value)} /></Field><Button className="danger" type="submit" disabled={confirmation !== "DELETE"} loading={privacy.busy}><Trash2 size={16} aria-hidden="true" /> {data.capabilities.localOnly ? "Permanently delete local account" : "Permanently delete account"}</Button></form></div>
    </section>
  </>;
}
