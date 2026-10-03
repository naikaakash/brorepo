import { useState } from "react";
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Check, Download, ExternalLink, FileCheck2, FileText, LockKeyhole, Plus, Search, ShieldCheck, Sparkles } from "lucide-react";
import { applicationSchema, applicationStates, changeSchema, jobInputSchema, jobSchema, packageSchema } from "@applymate/contracts";
import type { Application, ApplicationPackage, Change, Job, z } from "@applymate/contracts";
import { api, savedSchema } from "./api";
import { Badge, Button, Empty, Field, Notice, PageTitle } from "./ui";
import { date, downloadPackage, useAction, useResource } from "./hooks";
import type { PageProps } from "./ui";

const initialJob: z.infer<typeof jobInputSchema> = { title: "", company: "", location: "", workStyle: "unknown", salaryMinimum: null, salaryMaximum: null, currency: "USD", sourceUrl: "", description: "" };
const pending = (pkg: ApplicationPackage) => ["queued", "generating", "reviewing"].includes(pkg.state);
const packageLabel = (state: string) => ({ needs_review: "Your review needed", approved: "Approved & locked", queued: "Queued", generating: "Generating", reviewing: "Running checks", blocked: "Changes needed", failed: "Generation failed" })[state] ?? state;
const engineLabel = (engine: string) => engine === "Evidence-only local" ? engine : `${engine.split(":")[0]} / ${engine.split(":")[2]}`;
const statusTone = (status: string) => ["approved", "supported", "pass", "Offer"].includes(status) ? "green" : ["blocked", "failed", "fail", "missing"].includes(status) ? "red" : ["partial", "needs_review", "Human Action Required"].includes(status) ? "amber" : "purple";

export function JobsPage(props: PageProps & { selectedId?: string }) {
  const { data, selectedId, navigate, refresh } = props;
  const [importing, setImporting] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [form, setForm] = useState(initialJob);
  const action = useAction();
  const selected = data.jobs.find((job) => job.id === selectedId);
  if (selectedId) return selected ? <JobDetail {...props} job={selected} key={selected.id} /> : <><PageTitle eyebrow="OPPORTUNITIES" title="Opportunity unavailable" description="This job is not in your current workspace." /><a className="text-link" href="#jobs">Back to opportunities</a></>;
  const jobs = data.jobs.filter((job) => showDismissed || job.state === "saved");
  return <>
    <PageTitle eyebrow="FIND THE CONNECTION, NOT JUST A KEYWORD" title="Your opportunities" description="Bring a real job description. See exactly which requirements your confirmed experience supports."
      action={<Button className="primary" onClick={() => setImporting(!importing)}><Plus size={17} aria-hidden="true" /> {importing ? "Close import" : "Import a job"}</Button>} />
    {(importing || !data.jobs.length) && <section className="card"><div className="section-heading"><div><Badge tone="purple">A REAL ROLE. A CLOSER LOOK.</Badge><h2>Import a job description</h2><p>Paste the description yourself. Links are references only; ApplyMate does not scrape the page.</p></div><Search size={27} className="purple-ink" aria-hidden="true" /></div>
      <form onSubmit={(event) => { event.preventDefault(); void action.run(async () => {
        const job = await api.request("/jobs", jobSchema, { method: "POST", body: jobInputSchema.parse(form) });
        setForm(initialJob); setImporting(false); await refresh(); navigate(`jobs/${job.id}`);
      }); }}>
        <div className="form-grid"><Field label="Job title"><input required minLength={2} maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Software Engineer" /></Field>
          <Field label="Company"><input required minLength={2} maxLength={200} value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="Company name" /></Field>
          <Field label="Job location"><input maxLength={200} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="As stated in the listing" /></Field>
          <Field label="Work arrangement"><select value={form.workStyle} onChange={(event) => setForm({ ...form, workStyle: jobInputSchema.shape.workStyle.parse(event.target.value) })}><option value="unknown">Not stated</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></select></Field>
          <Field label="Minimum listed annual salary"><input type="number" min={0} max={10000000} value={form.salaryMinimum ?? ""} onChange={(event) => setForm({ ...form, salaryMinimum: event.target.value ? Number(event.target.value) : null })} placeholder="Leave blank if not stated" /></Field>
          <Field label="Maximum listed annual salary"><input type="number" min={0} max={10000000} value={form.salaryMaximum ?? ""} onChange={(event) => setForm({ ...form, salaryMaximum: event.target.value ? Number(event.target.value) : null })} placeholder="Leave blank if not stated" /></Field>
          <Field label="Salary currency"><select value={form.currency} onChange={(event) => setForm({ ...form, currency: jobInputSchema.shape.currency.parse(event.target.value) })}>{jobInputSchema.shape.currency.options.map((currency) => <option key={currency}>{currency}</option>)}</select></Field>
          <Field label="Original job URL" hint="Optional reference. Only HTTP or HTTPS links."><input type="url" maxLength={2000} value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} placeholder="https://..." /></Field>
        </div>
        <Field label="Job description" hint="At least 80 characters. Include requirements and responsibilities; leave out recruiter contact details."><textarea rows={8} minLength={80} maxLength={30000} required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Paste the complete job description..." /></Field>
        {action.feedback}<div className="button-row"><Button className="primary" type="submit" loading={action.busy}>Save & map the evidence <ArrowRight size={17} aria-hidden="true" /></Button><span className="subtle">Local analysis. No model call or employer contact.</span></div>
      </form>
    </section>}
    <section className="card"><div className="section-heading"><h2>Saved roles <span className="muted-count">{jobs.length}</span></h2><label className="check-row compact"><input type="checkbox" checked={showDismissed} onChange={(event) => setShowDismissed(event.target.checked)} /> Include dismissed</label></div>
      {!jobs.length ? <Empty title="Give your next move a starting point.">Your imported roles will appear here, with transparent evidence rather than a mysterious match score.</Empty> :
        <div className="job-grid">{jobs.map((job) => <a className="job-card" key={job.id} href={`#jobs/${job.id}`}><div className="between"><span className="company-mark">{job.company.slice(0, 2).toUpperCase()}</span><Badge tone={job.analysis.hardFilters.length ? "amber" : "purple"}>{job.state === "dismissed" ? "Dismissed" : job.analysis.hardFilters.length ? "Preference conflict" : `${job.analysis.score}% evidence coverage`}</Badge></div><h3>{job.title}</h3><p>{job.company}</p><div className="job-meta"><span>{job.location || "Location not stated"}</span><span>{job.workStyle === "unknown" ? "Arrangement not stated" : job.workStyle}</span></div><div className="job-card-footer"><span>Added {date(job.createdAt)}</span><ArrowRight size={17} aria-hidden="true" /></div></a>)}</div>}
    </section>
  </>;
}

function JobDetail({ data, job, refresh, navigate }: PageProps & { job: Job }) {
  const action = useAction();
  const [connection, setConnection] = useState("");
  const [providerConsent, setProviderConsent] = useState(false);
  const [reason, setReason] = useState("");
  const stale = job.analysis.profileRevision !== data.profile.revision;
  return <>
    <a className="back-link" href="#jobs"><ArrowLeft size={16} aria-hidden="true" /> All opportunities</a>
    <PageTitle eyebrow={job.company.toUpperCase()} title={job.title} description={`${job.location || "Location not specified"} / ${job.workStyle === "unknown" ? "Work arrangement not stated" : job.workStyle}`} action={<Badge tone={job.state === "saved" ? "purple" : ""}>{job.state}</Badge>} />
    {action.feedback}
    {stale && <Notice tone="warning">Your candidate facts changed since this analysis. Refresh the evidence map before relying on its coverage.</Notice>}
    {job.analysis.hardFilters.length > 0 && <Notice tone="warning"><strong>Your boundaries come first.</strong><ul>{job.analysis.hardFilters.map((filter) => <li key={filter}>{filter}</li>)}</ul>Draft creation is blocked until this role meets your preferences.</Notice>}
    <div className="job-detail-grid"><section className="card"><div className="section-heading"><div><p className="eyebrow">SHOW THE CONNECTION</p><h2>Requirement-to-evidence map</h2></div><div className="score"><strong>{job.analysis.score}%</strong><span>supported requirements</span></div></div>
      <p className="subtle">{job.analysis.method}. Exact term coverage, not a hiring probability. Qualifiers and missing facts are never filled in.</p>
      <Button className="secondary small" loading={action.busy} onClick={() => { void action.run(async () => { await api.request(`/jobs/${job.id}/analyze`, jobSchema, { method: "POST", body: {} }); await refresh(); }, "Evidence map refreshed."); }}>Refresh evidence map</Button>
      <div className="requirement-list">{job.analysis.requirements.map((requirement) => <article key={requirement.id}><div className="between"><Badge tone={statusTone(requirement.status)}>{requirement.status}</Badge><span className="subtle">{requirement.priority}</span></div><h3>{requirement.text}</h3><p>{requirement.rationale}</p>
        {!!requirement.factIds.length && <details><summary>View the cited facts ({requirement.factIds.length})</summary>{requirement.factIds.map((id) => <blockquote key={id}>{data.profile.facts.find((fact) => fact.id === id)?.text ?? "Source fact has changed. Refresh the evidence map."}</blockquote>)}</details>}
      </article>)}</div>
    </section><aside className="stack"><section className="card soft"><span className="icon-tile"><FileCheck2 aria-hidden="true" /></span><h2>A grounded first draft</h2><p>Organize verified experience for this role. Then check the facts, tone, and readability before you approve anything.</p>
      <Field label="Draft engine"><select value={connection} onChange={(event) => { setConnection(event.target.value); setProviderConsent(false); }}><option value="">Evidence-only local - no AI call</option>{data.connections.filter((item) => item.status === "connected").map((item) => <option key={item.id} value={item.id}>{item.provider} / {item.model}</option>)}</select></Field>
      {connection ? <label className="check-row"><input type="checkbox" checked={providerConsent} onChange={(event) => setProviderConsent(event.target.checked)} /><span>I agree to send verified facts, writing samples, and this job description to this provider. Generation and independent review make separate requests and may incur charges. Saving edits can make another paid review request.</span></label> :
        <p className="subtle">Local mode preserves the wording of your facts, groups sections, and highlights supported keywords. It does not pretend to be a model.</p>}
      <Button className="primary full" loading={action.busy} disabled={job.state !== "saved" || job.analysis.hardFilters.length > 0 || Boolean(connection && !providerConsent)} onClick={() => {
        void action.run(async () => {
          const pkg = await api.request("/packages", packageSchema, { method: "POST", body: { jobId: job.id, ...(connection ? { connectionId: connection, consent: true } : {}) } });
          await refresh(); navigate(`studio/${pkg.id}`);
        });
      }}><Sparkles size={17} aria-hidden="true" /> Create a draft</Button><p className="subtle">{data.preferences.dailyLimit} packages per UTC day maximum. Human review is always required.</p>
    </section>
      <section className="card"><h3>The original listing</h3><p>Keep the original description in view. Employer requirements are targets, never evidence about you.</p>{job.sourceUrl && <a className="button secondary full" href={job.sourceUrl} target="_blank" rel="noopener noreferrer">Open your reference link <ExternalLink size={15} aria-hidden="true" /></a>}<details className="description-details"><summary>Read saved job description</summary><p className="preserve-lines">{job.description}</p></details></section>
      <section className="card"><h3>{job.state === "saved" ? "Not the right fit?" : "Reconsidering this role?"}</h3><Field label="Decision note"><input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Optional reason" /></Field><Button className="secondary full" loading={action.busy} onClick={() => {
        void action.run(async () => { await api.request(`/jobs/${job.id}`, savedSchema, { method: "PATCH", body: { state: job.state === "saved" ? "dismissed" : "saved", reason } }); await refresh(); });
      }}>{job.state === "saved" ? "Dismiss opportunity" : "Reopen opportunity"}</Button>{job.declineReason && <p className="subtle">Saved note: {job.declineReason}</p>}</section>
    </aside></div>
  </>;
}

export function StudioPage(props: PageProps & { selectedId?: string }) {
  if (props.selectedId) return <PackageDetail {...props} id={props.selectedId} key={props.selectedId} />;
  return <>
    <PageTitle eyebrow="THOUGHTFUL DRAFTS. YOUR FINAL SAY." title="Document studio" description="Every version has a source, a review history, and a clear approval state." action={<a className="button secondary" href="#jobs">Choose an opportunity <ArrowRight size={16} aria-hidden="true" /></a>} />
    <section className="card">{props.data.packages.length ? <div className="package-list">{props.data.packages.map((pkg) => {
      const job = props.data.jobs.find((entry) => entry.id === pkg.jobId);
      return <a className="package-row" href={`#studio/${pkg.id}`} key={pkg.id}><span className="stat-icon purple"><FileText size={23} aria-hidden="true" /></span><div><h3>{job?.title ?? "Saved opportunity"}</h3><p>{job?.company} &middot; Version {pkg.version} &middot; {engineLabel(pkg.engine)}</p><span className="subtle">{date(pkg.createdAt)}</span></div><Badge tone={statusTone(pkg.state)}>{packageLabel(pkg.state)}</Badge><ArrowRight size={17} aria-hidden="true" /></a>;
    })}</div> : <Empty title="Your story, shaped for the opportunity." action={<a className="button primary" href="#jobs">Start with a job description</a>}>Create your first draft from an opportunity. Your confirmed facts and writing profile will travel with every version.</Empty>}</section>
  </>;
}

function PackageDetail({ id, ...props }: PageProps & { id: string }) {
  const resource = useResource(`/packages/${id}`, packageSchema, pending);
  return <>
    <a className="back-link" href="#studio"><ArrowLeft size={16} aria-hidden="true" /> All document versions</a>
    <PageTitle eyebrow="YOUR EXPERIENCE, WITH RECEIPTS" title={resource.data ? `${resource.data.job.title} - v${resource.data.version}` : "Document review"} description={resource.data ? `${resource.data.job.company} / ${engineLabel(resource.data.engine)}` : "Opening your saved version..."} />
    {resource.error && <Notice tone="error">{resource.error}<Button className="text-button" onClick={resource.reload}>Retry</Button></Notice>}
    {resource.data ? pending(resource.data) ? <div className="card working-card"><Sparkles className="pulse" size={38} aria-hidden="true" /><h2>{packageLabel(resource.data.state)}</h2><p role="status">Your draft is saved in the local queue. Facts, voice, and readability are checked in separate steps.</p><p className="subtle">Nothing is being sent to an employer. You can leave this page and return to the saved version.</p></div> :
      <PackageEditor {...props} pkg={resource.data} reload={resource.reload} key={`${id}:${resource.data.updatedAt}`} /> : !resource.error && <p role="status">Loading your document...</p>}
  </>;
}
function PackageEditor({ data, pkg, refresh, navigate, reload }: PageProps & { pkg: ApplicationPackage; reload: () => void }) {
  const [changes, setChanges] = useState<Change[]>(pkg.changes);
  const [acknowledged, setAcknowledged] = useState(false);
  const action = useAction();
  const locked = pkg.state === "approved";
  const dirty = JSON.stringify(changes) !== JSON.stringify(pkg.changes);
  const canApprove = !dirty && pkg.state === "needs_review" && pkg.reviews.every((review) => review.status === "pass") && changes.length > 0 && changes.every((change) => change.decision !== "pending");
  const application = data.applications.find((entry) => entry.jobId === pkg.jobId);
  function update(id: string, patch: Partial<Change>) { setChanges((current) => current.map((change) => change.id === id ? { ...change, ...patch } : change)); }
  return <>
    {action.feedback}
    {pkg.error && <Notice tone="error">{pkg.error} <a className="text-link" href={`#jobs/${pkg.jobId}`}>Return to the opportunity to create a new version.</a></Notice>}
    {locked ? <Notice tone="success"><strong>Approved and locked on {date(pkg.approvedAt!)}.</strong> This exact version will not change when you edit your profile. Approval does not mean submission.</Notice> :
      <Notice>Review the original and proposed wording, then approve or exclude every statement. Editing in local mode cannot introduce new wording or claims; update your candidate facts and create a new version when needed.</Notice>}
    <div className="reviewer-grid">{pkg.reviews.map((review) => <section className="card reviewer-card" key={review.reviewer}><div className="between"><ShieldCheck size={22} aria-hidden="true" /><Badge tone={statusTone(review.status)}>{review.status === "pass" ? "Passed" : "Needs attention"}</Badge></div><h3>{review.reviewer}</h3><p className="review-method">{review.method}</p><details><summary>See findings ({review.findings.length})</summary><ul>{review.findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul></details></section>)}</div>
    <p className="subtle">These checks support your review; they do not guarantee semantic accuracy, an ATS outcome, or an interview.</p>
    {pkg.changes.length > 0 && <section className="card"><div className="section-heading"><div><p className="eyebrow">NOTHING CHANGES IN THE DARK</p><h2>Original &amp; proposed wording</h2><p>Candidate revision {pkg.profileRevision} &middot; Voice version {pkg.voice.version}</p></div><Badge tone={locked ? "green" : "amber"}>{changes.filter((change) => change.decision === "approved").length}/{changes.length} included</Badge></div>
      {!locked && <div className="button-row fact-toolbar"><Button className="secondary small" onClick={() => setChanges(changes.map((change) => change.decision === "pending" && change.proposed === change.original ? { ...change, decision: "approved" } : change))}><Check size={16} aria-hidden="true" /> Approve unchanged statements</Button><span className="subtle">Only after checking the exact source wording.</span></div>}
      <div className="change-list">{changes.map((change, index) => <article className={`change-card ${change.decision === "rejected" ? "excluded" : ""}`} key={change.id}>
        <div className="change-header"><span className="item-number">STATEMENT {String(index + 1).padStart(2, "0")} &middot; {change.section}</span><Badge tone={change.decision === "approved" ? "green" : ""}>{change.decision === "rejected" ? "Excluded" : change.decision}</Badge></div>
        <div className="comparison"><div className="original"><span className="eyebrow">ORIGINAL CONFIRMED FACT</span><p>{change.original}</p></div><div className="proposed">{locked ? <><span className="eyebrow">APPROVED VERSION</span><p>{change.proposed}</p></> : <Field label={`Proposed statement ${index + 1}`}><textarea rows={3} maxLength={2000} value={change.proposed} onChange={(event) => update(change.id, { proposed: event.target.value, decision: "pending" })} /></Field>}</div></div>
        <div className="change-reason"><Sparkles size={15} aria-hidden="true" /><p>{change.reason}</p></div>
        <div className="between"><div className="keyword-list">{change.keywords.map((keyword) => <Badge tone="purple" key={keyword}>{keyword}</Badge>)}</div>{!locked && <Field label={`Decision for statement ${index + 1}`}><select value={change.decision} onChange={(event) => update(change.id, { decision: changeSchema.shape.decision.parse(event.target.value) })}><option value="pending">Not reviewed yet</option><option value="approved">Approve this statement</option><option value="rejected">Exclude this statement</option></select></Field>}</div>
        <details className="source-details"><summary>Trace to the source</summary><p className="subtle">Fact ID: {change.factId}</p><blockquote>{pkg.facts.find((fact) => fact.id === change.factId)?.source.excerpt}</blockquote></details>
      </article>)}</div>
      {!locked && <div className="button-row"><Button className="primary" loading={action.busy} onClick={() => {
        void action.run(async () => {
          await api.request(`/packages/${pkg.id}/review`, packageSchema, { method: "PUT", body: { changes: changes.map(({ id, proposed, decision }) => ({ id, proposed, decision })) } });
          await refresh(); reload();
        }, "Your decisions were saved and the checks ran again.");
      }}>Save decisions & rerun checks</Button>{dirty && <Badge tone="amber">Unsaved review changes</Badge>}</div>}
    </section>}
    {pkg.coverLetter && <section className="card"><div className="section-heading"><div><p className="eyebrow">THE SAME FACTS, A SIMPLE INTRODUCTION</p><h2>Cover letter preview</h2></div><Badge>{locked ? "Locked version" : "Updates after saving decisions"}</Badge></div><div className="letter-preview preserve-lines">{pkg.coverLetter}</div></section>}
    {!locked && pkg.changes.length > 0 && <section className="card approval-panel"><span className="icon-tile"><LockKeyhole aria-hidden="true" /></span><h2>Make it a version you stand behind.</h2><p>Save your decisions, pass every check, and approve the exact included text. Future edits require a new version.</p><label className="check-row"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I checked every included claim and the cover letter. I approve this exact document version.</span></label>
      <Button className="primary" loading={action.busy} disabled={!canApprove || !acknowledged} onClick={() => {
        void action.run(async () => { await api.request(`/packages/${pkg.id}/approve`, packageSchema, { method: "POST", body: { acknowledged: true } }); await refresh(); reload(); });
      }}><LockKeyhole size={17} aria-hidden="true" /> Approve & lock this version</Button>
      {!canApprove && <p className="subtle">All statements need a saved decision, and every reviewer must pass.</p>}
    </section>}
    {locked && <section className="card export-panel"><div><p className="eyebrow">READY WHEN YOU ARE</p><h2>Take your approved story with you.</h2><p>Real PDF and Word documents. Single-column, text-based, and built from this locked version.</p></div>
      <div className="export-buttons">{(["resume", "cover"] as const).flatMap((kind) => (["pdf", "docx"] as const).map((format) => <Button key={`${kind}-${format}`} className="secondary" loading={action.busy} onClick={() => { void action.run(() => downloadPackage(pkg.id, kind, format)); }}><Download size={17} aria-hidden="true" /> {kind === "resume" ? "Resume" : "Cover letter"} {format.toUpperCase()}</Button>))}</div>
      <details className="source-details"><summary>Immutable document fingerprint</summary><code className="hash">{pkg.hash}</code></details>
      <Button className="primary" loading={action.busy} onClick={() => { void action.run(async () => {
        if (application) { navigate(`applications/${application.id}`); return; }
        const created = await api.request("/applications", applicationSchema, { method: "POST", body: { packageId: pkg.id } });
        await refresh(); navigate(`applications/${created.id}`);
      }); }}><BriefcaseBusiness size={17} aria-hidden="true" /> {application ? "Open application record" : "Prepare application record"}<ArrowRight size={17} aria-hidden="true" /></Button><p className="subtle">This creates a tracking record, not an employer submission.</p>
    </section>}
  </>;
}

export function ApplicationsPage(props: PageProps & { selectedId?: string }) {
  if (props.selectedId) return <ApplicationDetail {...props} id={props.selectedId} key={props.selectedId} />;
  return <>
    <PageTitle eyebrow="LESS TO KEEP IN YOUR HEAD" title="Your applications" description="A clear record of what you prepared, what you reported, and what needs your attention." action={<Badge tone="amber">Manual applications only</Badge>} />
    <Notice>Prepared is not submitted. Employer actions are recorded only from your explicit confirmation and are labeled user-reported.</Notice>
    <section className="card">{props.data.applications.length ? <div className="application-list">{props.data.applications.map((application) => <a className="application-row" href={`#applications/${application.id}`} key={application.id}><span className="company-mark">{application.company.slice(0, 2).toUpperCase()}</span><div><h3>{application.title}</h3><p>{application.company}</p><span className="subtle">Updated {date(application.updatedAt)}</span></div><div className="application-status"><Badge tone={statusTone(application.state)}>{application.state}</Badge><small>{application.evidence ? "User-reported confirmation" : "No submission recorded"}</small></div><ArrowRight size={17} aria-hidden="true" /></a>)}</div> :
      <Empty title="A little more clarity, from the first application." action={<a className="button primary" href="#studio">Go to document studio</a>}>Approve a document package, then prepare an application record. No fake totals or pretend submissions.</Empty>}</section>
  </>;
}
function ApplicationDetail({ id, ...props }: PageProps & { id: string }) {
  const resource = useResource(`/applications/${id}`, applicationSchema);
  return <>
    <a className="back-link" href="#applications"><ArrowLeft size={16} aria-hidden="true" /> All applications</a>
    <PageTitle eyebrow="YOUR APPLICATION, WITH A PAPER TRAIL" title={resource.data?.snapshot.job.title ?? "Application record"} description={resource.data?.snapshot.job.company ?? "Loading the exact saved snapshot..."} />
    {resource.error && <Notice tone="error">{resource.error}<Button className="text-button" onClick={resource.reload}>Retry</Button></Notice>}
    {resource.data ? <ApplicationEditor {...props} application={resource.data} reload={resource.reload} key={resource.data.updatedAt} /> : !resource.error && <p role="status">Opening your saved application...</p>}
  </>;
}
function ApplicationEditor({ application, refresh, reload }: PageProps & { application: Application; reload: () => void }) {
  const [state, setState] = useState<Application["state"]>(application.state);
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");
  const action = useAction();
  const external = ["Submitted", "Under Review", "Assessment", "Interview", "Rejected", "Offer"].includes(state);
  return <>
    {action.feedback}
    <div className="job-detail-grid"><div className="stack"><section className="card action-center"><Badge tone={statusTone(application.state)}>{application.state}</Badge><h2>{application.state === "Human Action Required" ? "Your next step is a human one." : "Keep your record true to what happened."}</h2><p>Download your approved documents, apply through the employer, and save a confirmation here. This app does not log in to job sites or send applications.</p><div className="button-row"><Button className="secondary" loading={action.busy} onClick={() => { void action.run(() => downloadPackage(application.packageId, "resume", "pdf")); }}><Download size={17} aria-hidden="true" /> Approved resume PDF</Button>{application.snapshot.job.sourceUrl && <a className="button primary" href={application.snapshot.job.sourceUrl} target="_blank" rel="noopener noreferrer">Open employer reference <ExternalLink size={16} aria-hidden="true" /></a>}</div>
      {application.evidence && <div className="context-note"><strong>User-reported confirmation</strong><p>{application.evidence.reference}</p><small>Recorded {date(application.evidence.at)}. Not independently verified by ApplyMate.</small></div>}</section>
      <section className="card"><h2>Update the application record</h2><p>Record what happened, not what you hope happened. No update sends anything to an employer.</p>
        <form onSubmit={(event) => { event.preventDefault(); void action.run(async () => {
          await api.request(`/applications/${application.id}`, applicationSchema, { method: "PATCH", body: { state, note, ...(external ? { evidence } : {}) } });
          await refresh(); reload();
        }); }}>
          <Field label="Application status"><select value={state} onChange={(event) => setState(applicationSchema.shape.state.parse(event.target.value))}>{applicationStates.map((status) => <option key={status}>{status}</option>)}</select></Field>
          <Field label="What happened?" hint="A short, factual note for your timeline."><textarea required minLength={5} maxLength={1000} rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></Field>
          {external && <Field label="Employer confirmation or reference" hint="At least 15 characters. Paste a confirmation reference or describe the employer message and date. This remains user-reported evidence."><textarea required minLength={15} maxLength={2000} rows={3} value={evidence} onChange={(event) => setEvidence(event.target.value)} /></Field>}
          <Button className="primary" type="submit" loading={action.busy}>Save user-reported update</Button>
        </form>
      </section>
      <section className="card"><h2>The exact prepared version</h2><p>Version {application.snapshot.version} &middot; Candidate revision {application.snapshot.profileRevision} &middot; Voice version {application.snapshot.voice.version}</p><a className="text-link" href={`#studio/${application.packageId}`}>Open the approved package <ArrowRight size={15} aria-hidden="true" /></a><details className="source-details"><summary>View the snapshot and fingerprint</summary><code className="hash">{application.snapshot.hash}</code>{application.snapshot.changes.filter((change) => change.decision === "approved").map((change) => <p key={change.id}>{change.proposed}</p>)}</details>
        <details className="source-details"><summary>Confirmed reusable answers ({application.answers.length})</summary>{application.answers.length ? application.answers.map((answer) => <div key={answer.id}><h3>{answer.question}</h3><p>{answer.versions.at(-1)?.answer}</p><small>Version {answer.versions.at(-1)?.version}</small></div>) : <p>No standard answers had explicit reuse approval when this application was prepared.</p>}</details>
      </section>
    </div><aside className="card timeline-card"><p className="eyebrow">THE STORY SO FAR</p><h2>Application timeline</h2><ol className="timeline">{[...application.timeline].reverse().map((event, index) => <li key={`${event.at}-${index}`}><span className="timeline-dot" /><time dateTime={event.at}>{date(event.at)}</time><h3>{event.type}</h3><p>{event.message}</p>{event.evidence && <blockquote><strong>User-reported reference</strong><br />{event.evidence}</blockquote>}</li>)}</ol></aside></div>
  </>;
}
