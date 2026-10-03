import { ArrowRight, BriefcaseBusiness, Check, FileCheck2, Fingerprint, Search, ShieldCheck, Sparkles } from "lucide-react";
import { Badge, Button, Empty, PageTitle } from "./ui";
import { date } from "./hooks";
import type { PageProps } from "./ui";

export function Dashboard({ data, navigate }: PageProps) {
  const verified = data.profile.facts.filter((fact) => fact.state === "verified").length;
  const preferencesConfirmed = data.profile.onboardingStep === "complete";
  const steps = [
    { label: "Upload your resume", detail: "A starting point, not another blank form.", done: data.profile.documentIds.length > 0, path: "profile" },
    { label: "Make the facts yours", detail: "Confirm what is true. Fill only the gaps.", done: verified > 0 && data.profile.fields.fullName.state === "verified" && data.profile.fields.email.state === "verified", path: "profile" },
    { label: "Find your natural voice", detail: "Writing that sounds like you, on a good day.", done: Boolean(data.voice?.complete), path: "voice" },
    { label: "Set your direction", detail: "Roles, locations, and boundaries that matter.", done: preferencesConfirmed, path: "preferences" }
  ];
  const ready = steps.every((step) => step.done);
  const submitted = data.applications.filter((application) => application.evidence !== null).length;
  const name = data.profile.fields.fullName.value.split(" ")[0];
  return <>
    <PageTitle eyebrow="YOUR WORKSPACE" title={name ? `A good next step, ${name}.` : "Good things start here."}
      description="One place for your experience, your opportunities, and everything in between."
      action={<Badge tone="green"><ShieldCheck size={14} aria-hidden="true" /> Review mode</Badge>} />
    <section className="welcome-card">
      <div><Badge tone="white">YOUR SEARCH. ON YOUR TERMS.</Badge><h2>{ready ? "Less busywork.\nMore possibility." : "You bring the story.\nWe help it come through."}</h2>
        <p>{ready ? "Your candidate profile is ready. Import a job to see where your experience connects, and where it does not." : "Start with your resume. We will organize the facts, then you decide what belongs in your profile."}</p>
        <Button className="dark" onClick={() => navigate(ready ? "jobs" : steps.find((step) => !step.done)!.path)}>
          {ready ? "Find your next opportunity" : data.profile.documentIds.length ? "Continue your setup" : "Start with your resume"}<ArrowRight size={18} aria-hidden="true" />
        </Button>
      </div>
      <div className="welcome-art" aria-hidden="true"><div className="floating-sheet"><Fingerprint size={48} strokeWidth={1.3} /><span className="sheet-title">Made of your experience.</span><i /><i /><i /><span className="sheet-approved"><Check size={13} /> Human approved</span></div><Sparkles className="art-sparkle" size={38} /></div>
    </section>
    <section className="stat-grid" aria-label="Your real workspace totals">
      {[{ label: "Verified career facts", value: verified, icon: Fingerprint, color: "purple" },
        { label: "Saved opportunities", value: data.jobs.filter((job) => job.state === "saved").length, icon: Search, color: "pink" },
        { label: "Approved packages", value: data.packages.filter((pkg) => pkg.state === "approved").length, icon: FileCheck2, color: "mint" },
        { label: "Applications tracked", value: data.applications.length, icon: BriefcaseBusiness, color: "peach" }].map(({ label, value, icon: Icon, color }) =>
        <article className="stat-card" key={label}><span className={`stat-icon ${color}`}><Icon size={22} aria-hidden="true" /></span><div><strong>{value}</strong><span>{label}</span></div></article>)}
    </section>
    <div className="dashboard-grid">
      <section className="card"><div className="section-heading"><div><p className="eyebrow">A STRONG FOUNDATION</p><h2>Your candidate profile</h2></div><span className="completion-number">{steps.filter((step) => step.done).length}/4</span></div>
        <progress className="progress" value={steps.filter((step) => step.done).length} max={4} aria-label="Setup completion" />
        <div className="setup-steps">{steps.map((step, index) => <a href={`#${step.path}`} key={step.label} className="setup-step" aria-label={`${step.label} (${step.done ? "complete" : "not complete"})`}>
          <span className={`step-number ${step.done ? "done" : ""}`}>{step.done ? <Check size={16} aria-hidden="true" /> : index + 1}</span><div><strong>{step.label}</strong><p>{step.detail}</p></div><ArrowRight size={17} aria-hidden="true" />
        </a>)}</div>
      </section>
      <section className="card trust-card"><span className="icon-tile mint"><ShieldCheck size={27} aria-hidden="true" /></span><p className="eyebrow">CONFIDENCE, NOT GUESSWORK</p><h2>You stay in the loop.<br />Always.</h2><p>Every claim points back to a confirmed fact. Every document waits for your approval. Nothing goes to an employer behind your back.</p>
        <div className="trust-fact"><Check size={17} aria-hidden="true" /> {submitted} application{submitted === 1 ? "" : "s"} with user-reported confirmation</div>
        <div className="trust-fact"><Check size={17} aria-hidden="true" /> No automatic submissions enabled</div>
        <div className="trust-fact"><Check size={17} aria-hidden="true" /> No external AI calls in local mode</div>
      </section>
    </div>
    <section className="card"><div className="section-heading"><div><p className="eyebrow">ROOM FOR WHAT COMES NEXT</p><h2>Your opportunities</h2></div><a className="text-link" href="#jobs">View all <ArrowRight size={15} aria-hidden="true" /></a></div>
      {data.jobs.filter((job) => job.state === "saved").length ? <div className="opportunity-list">{data.jobs.filter((job) => job.state === "saved").slice(0, 3).map((job) =>
        <a className="opportunity-row" href={`#jobs/${job.id}`} key={job.id}><span className="company-mark">{job.company.slice(0, 2).toUpperCase()}</span><div><strong>{job.title}</strong><p>{job.company} &middot; {job.location || "Location not specified"}</p></div><Badge tone="purple">{job.analysis.score}% evidence coverage</Badge><ArrowRight size={18} aria-hidden="true" /></a>)}</div> :
        <Empty title="The right opportunity starts with a closer look." action={<Button className="secondary" onClick={() => navigate("jobs")}>Import a job description <ArrowRight size={16} aria-hidden="true" /></Button>}>Add a real job description to compare its requirements with your confirmed experience.</Empty>}
    </section>
    {data.preferences.notifications && data.activity.length > 0 && <section className="card"><h2>Recently in your workspace</h2><div className="activity-list">{data.activity.slice(0, 5).map((event) => <div key={event.id}><span className="activity-dot" /><div><strong>{event.action}</strong><p>{event.detail}</p></div><time dateTime={event.createdAt}>{date(event.createdAt)}</time></div>)}</div></section>}
  </>;
}
