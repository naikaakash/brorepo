import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, FileText, Plus, Sparkles, Upload, X } from "lucide-react";
import { documentSchema, factSchema, factStateSchema, fieldNames, profileUpdateSchema, voicePrompts, voiceSchema, z } from "@applymate/contracts";
import type { DocumentRecord, FieldName, Voice } from "@applymate/contracts";
import { api, savedSchema } from "./api";
import { Badge, Button, Field, Notice, PageTitle } from "./ui";
import { date, phrases, useAction } from "./hooks";
import type { PageProps } from "./ui";

const labels: Record<FieldName, string> = { fullName: "Full name", email: "Contact email", phone: "Phone", location: "Location", headline: "Professional headline", website: "Website" };
const uploadSchema = z.object({ document: documentSchema, mergeRequired: z.boolean() });
type FactInput = z.infer<typeof profileUpdateSchema>["facts"][number];

export function ProfilePage({ data, refresh, navigate }: PageProps) {
  const profile = data.profile;
  const [file, setFile] = useState<File | null>(null);
  const [merge, setMerge] = useState<DocumentRecord | null>(null);
  const [selectedFields, setSelectedFields] = useState<FieldName[]>([]);
  const [selectedFacts, setSelectedFacts] = useState<string[]>([]);
  const [revision, setRevision] = useState(profile.revision);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fields, setFields] = useState(profileUpdateSchema.shape.fields.parse(Object.fromEntries(fieldNames.map((key) => [key, profile.fields[key].value]))));
  const [facts, setFacts] = useState<FactInput[]>(profile.facts.map(({ id, text, category, state }) => ({ id, text, category, state })));
  const action = useAction();
  const uploads = useAction();
  const confirmedFields = profile.onboardingStep === "complete" ? [] :
    fieldNames.filter((key) => profile.fields[key].state === "verified" && profile.fields[key].value);
  if (revision !== profile.revision) {
    setRevision(profile.revision);
    setFields(profileUpdateSchema.shape.fields.parse(Object.fromEntries(fieldNames.map((key) => [key, profile.fields[key].value]))));
    setFacts(profile.facts.map(({ id, text, category, state }) => ({ id, text, category, state })));
  }
  function patchFact(id: string, patch: Partial<FactInput>) { setFacts((current) => current.map((fact) => fact.id === id ? { ...fact, ...patch } : fact)); }
  function contactField(key: FieldName) {
    return <div key={key}><Field label={labels[key]} hint={key === "email" ? "The contact email on your resume, not necessarily your sign-in email." : undefined}>
      <input value={fields[key]} required={key === "fullName" || key === "email"} type={key === "email" ? "email" : "text"} maxLength={500} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} />
    </Field>{profile.fields[key].value && <span className="source-label">{profile.fields[key].source.kind === "resume" ? "Extracted from resume" : profile.fields[key].source.kind === "account" ? "From account" : "Entered by you"} &middot; {profile.fields[key].state}</span>}</div>;
  }
  async function save(confirm: boolean) {
    await api.request("/profile", savedSchema, { method: "PUT", body: { revision: profile.revision, fields, facts, confirm } });
    await refresh();
    if (confirm && profile.onboardingStep !== "complete") navigate(data.voice?.complete ? "preferences" : "voice");
  }
  return <>
    <PageTitle eyebrow="THE FACTS BEHIND YOUR STORY" title="Your candidate profile" description="A living record of your experience. You confirm the facts; nothing gets invented to fill a gap." action={<Badge tone="purple">Revision {profile.revision}</Badge>} />
    <section className="card upload-card"><div className="upload-icon"><Upload size={27} aria-hidden="true" /></div><div className="upload-description"><h2>{profile.documentIds.length ? "Add another version of your resume" : "Start with your resume"}</h2><p>PDF, DOCX, or plain text. Up to 5 MB. Text-based files only; scanned PDFs need a text version.</p><p className="subtle">New uploads never silently replace your confirmed experience.</p></div>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!file || action.busy) return;
        void uploads.run(async () => {
          if (file.size > 5 * 1024 * 1024) throw new Error("Choose a file under 5 MB.");
          const body = new FormData(); body.append("resume", file);
          const result = await api.request("/documents", uploadSchema, { method: "POST", body });
          if (result.mergeRequired) { setMerge(result.document); setSelectedFields([]); setSelectedFacts([]); }
          setFile(null);
          if (fileInput.current) fileInput.current.value = "";
          await refresh();
        });
      }}><Field label="Resume file"><input ref={fileInput} type="file" accept=".pdf,.docx,.txt" required disabled={uploads.busy || action.busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Field><Button type="submit" className="primary" loading={uploads.busy || action.busy} disabled={!file}><Upload size={16} aria-hidden="true" /> {uploads.busy ? "Reading your resume" : "Upload resume"}</Button></form>
    </section>
    {uploads.feedback}
    {merge && <section className="card merge-panel"><div className="section-heading"><div><Badge tone="purple">MERGE PREVIEW</Badge><h2>Choose what to bring forward</h2><p>Everything stays unchecked until you choose it. Selected replacements return to proposed status.</p></div><Button className="icon-button" aria-label="Close merge preview" onClick={() => setMerge(null)}><X size={19} /></Button></div>
      {merge.warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
      <h3>Contact and profile fields</h3>
      {fieldNames.filter((key) => merge.proposedFields[key].value).map((key) => <label className="merge-choice" key={key}><input type="checkbox" checked={selectedFields.includes(key)} onChange={(event) => setSelectedFields((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))} /><div><strong>{labels[key]}</strong><p><span className="subtle">Current:</span> {profile.fields[key].value || "Not set"}</p><p><span className="subtle">New:</span> {merge.proposedFields[key].value}</p></div></label>)}
      <h3>Proposed career facts</h3>{merge.proposedFacts.map((fact) => <label className="merge-choice" key={fact.id}><input type="checkbox" checked={selectedFacts.includes(fact.id)} onChange={(event) => setSelectedFacts((current) => event.target.checked ? [...current, fact.id] : current.filter((item) => item !== fact.id))} /><div><Badge>{fact.category}</Badge><p>{fact.text}</p></div></label>)}
      <Button className="primary" loading={uploads.busy} disabled={!selectedFields.length && !selectedFacts.length} onClick={() => {
        void uploads.run(async () => {
          await api.request(`/documents/${merge.id}/merge`, savedSchema, { method: "POST", body: { revision: profile.revision, fields: selectedFields, factIds: selectedFacts } });
          setMerge(null); await refresh();
        }, "Selected facts merged as proposals. Review them before use.");
      }}>Merge selected proposals</Button>
    </section>}
    {!!data.documents.length && <section className="card"><div className="section-heading"><h2>Your source documents</h2><Badge>{data.documents.length}/30 files</Badge></div><div className="document-list">{data.documents.map((doc) => <div className="document-row" key={doc.id}><FileText size={23} aria-hidden="true" /><div><strong>{doc.name}</strong><p>{Math.max(1, Math.round(doc.size / 1024))} KB &middot; {date(doc.createdAt)} &middot; {profile.documentIds.includes(doc.id) ? "Added to profile" : "Merge pending"}</p>{doc.warnings.map((warning) => <p className="warning-text" key={warning}>{warning}</p>)}</div>
      <div className="button-row">{!profile.documentIds.includes(doc.id) && <Button className="secondary small" loading={uploads.busy} onClick={() => {
        void uploads.run(async () => { setMerge(await api.request(`/documents/${doc.id}`, documentSchema)); setSelectedFacts([]); setSelectedFields([]); });
      }}>Review merge</Button>}<Button className="icon-button" aria-label={`Download original ${doc.name}`} onClick={() => { void uploads.run(() => api.download(`/documents/${doc.id}/download`, doc.name, doc.mime)); }}><Download size={17} aria-hidden="true" /></Button></div>
    </div>)}</div></section>}
    <form onSubmit={(event) => { event.preventDefault(); if (!uploads.busy) void action.run(() => save(true), "Your confirmed profile was saved."); }}>
      <fieldset className="form-fields" disabled={action.busy || uploads.busy}>
      <section className="card"><div className="section-heading"><div><p className="eyebrow">JUST THE ESSENTIALS</p><h2>How you introduce yourself</h2></div><Badge>{profile.fields.fullName.state === "verified" ? "Confirmed" : "Needs your review"}</Badge></div>
        <div className="form-grid">{fieldNames.filter((key) => !confirmedFields.includes(key)).map(contactField)}</div>
        {confirmedFields.length > 0 && <details className="source-details"><summary>Already confirmed details ({confirmedFields.length})</summary><p>No need to enter these again. Open this section only if something needs correcting.</p><div className="form-grid">{confirmedFields.map(contactField)}</div></details>}
      </section>
      <section className="card"><div className="section-heading"><div><p className="eyebrow">YOUR EVIDENCE LIBRARY</p><h2>Career facts, not assumptions</h2><p>Review every extracted statement. Confirm accurate facts, correct the text, or exclude anything that does not belong.</p></div><Badge tone="green">{facts.filter((fact) => fact.state === "verified").length} verified</Badge></div>
        {facts.length > 0 && <div className="button-row fact-toolbar"><Button className="secondary small" onClick={() => setFacts(facts.map((fact) => fact.state === "proposed" ? { ...fact, state: "verified" } : fact))}><Check size={16} aria-hidden="true" /> Mark proposed facts verified</Button><span className="subtle">Only use this after reading every proposed fact.</span></div>}
        {!facts.length && <Notice>{profile.documentIds.length ? "No career facts were identified. Add only facts you can confirm." : "Upload your resume first, then review the extracted facts here."}</Notice>}
        <div className="facts-list">{facts.map((fact, index) => {
          const source = profile.facts.find((entry) => entry.id === fact.id)?.source;
          return <article className={`fact-card ${fact.state === "rejected" ? "excluded" : ""}`} key={fact.id}>
            <div className="fact-top"><span className="item-number">FACT {String(index + 1).padStart(2, "0")}</span><Badge tone={fact.state === "verified" ? "green" : fact.state === "rejected" ? "" : "amber"}>{fact.state === "rejected" ? "Excluded" : fact.state}</Badge></div>
            <Field label={`Fact ${index + 1}`}><textarea rows={2} value={fact.text} required maxLength={2000} onChange={(event) => patchFact(fact.id, { text: event.target.value })} /></Field>
            <div className="fact-controls"><Field label={`Category for fact ${index + 1}`}><select value={fact.category} onChange={(event) => patchFact(fact.id, { category: factSchema.shape.category.parse(event.target.value) })}>{factSchema.shape.category.options.map((category) => <option key={category} value={category}>{category}</option>)}</select></Field>
              <Field label={`Decision for fact ${index + 1}`}><select value={fact.state} onChange={(event) => patchFact(fact.id, { state: factStateSchema.parse(event.target.value) })}><option value="proposed">Proposed - not yet confirmed</option><option value="verified">Verified by me</option><option value="rejected">Exclude this fact</option></select></Field></div>
            {source && <details className="source-details"><summary>Source &amp; provenance &middot; {source.kind} &middot; {Math.round(source.confidence * 100)}% extraction confidence</summary><p className="subtle">Extraction confidence is a parsing heuristic, not proof that a statement is true.</p><blockquote>{source.excerpt}</blockquote></details>}
            {!source && <Button className="text-button danger-text small" onClick={() => setFacts((current) => current.filter((entry) => entry.id !== fact.id))}>Remove new fact</Button>}
          </article>;
        })}</div>
        <Button className="secondary" disabled={facts.length >= 250} onClick={() => setFacts([...facts, { id: crypto.randomUUID(), text: "", category: "experience", state: "proposed" }])}><Plus size={17} aria-hidden="true" /> Add a fact</Button>
      </section>
      </fieldset>
      {action.feedback}
      <div className="save-bar"><p><ShieldText /> Changes apply to future drafts. Approved versions stay untouched.</p><div className="button-row"><Button className="secondary" loading={action.busy || uploads.busy} onClick={() => { void action.run(() => save(false), "Draft saved."); }}>Save draft</Button><Button className="primary" type="submit" loading={action.busy || uploads.busy}>{profile.onboardingStep === "complete" ? "Save confirmed profile" : "Confirm profile & continue"}<ArrowRight size={17} aria-hidden="true" /></Button></div></div>
    </form>
  </>;
}
function ShieldText() { return <Check size={16} aria-hidden="true" />; }

export function VoicePage({ data, refresh, navigate }: PageProps) {
  const [index, setIndex] = useState(0);
  const [voiceId, setVoiceId] = useState(data.voice?.id);
  const [answers, setAnswers] = useState<Record<string, string>>(Object.fromEntries(data.voice?.answers.map((answer) => [answer.promptId, answer.text]) ?? []));
  const [polish, setPolish] = useState<Voice["polish"]>(data.voice?.polish ?? "Preserve My Style");
  const [preferred, setPreferred] = useState(data.voice?.preferredPhrases.join(", ") ?? "");
  const [banned, setBanned] = useState(data.voice?.bannedPhrases.join(", ") ?? "");
  const [versions, setVersions] = useState<Voice[] | null>(null);
  const action = useAction();
  if (voiceId !== data.voice?.id) {
    setVoiceId(data.voice?.id);
    setAnswers(Object.fromEntries(data.voice?.answers.map((answer) => [answer.promptId, answer.text]) ?? []));
    setPolish(data.voice?.polish ?? "Preserve My Style");
    setPreferred(data.voice?.preferredPhrases.join(", ") ?? "");
    setBanned(data.voice?.bannedPhrases.join(", ") ?? "");
  }
  const prompt = voicePrompts[index];
  const count = Object.values(answers).filter((answer) => answer.trim().length >= 20).length;
  const words = (Object.values(answers).join(" ").match(/\p{L}+(?:['\u2019]\p{L}+)?/gu) ?? []).length;
  return <>
    <PageTitle eyebrow="SOUND LIKE YOURSELF, ON A GOOD DAY" title="Your voice, not a template" description="A short, thoughtful writing interview. Everyday words are welcome. There are no perfect answers."
      action={data.voice && <Badge tone={data.voice.complete ? "green" : "amber"}>Version {data.voice.version} &middot; {data.voice.complete ? "Baseline ready" : "Draft"}</Badge>} />
    <fieldset className="voice-layout form-fields" disabled={action.busy}><section className="card voice-interview">
      <div className="section-heading"><Badge tone="purple"><Sparkles size={13} aria-hidden="true" /> WRITING INTERVIEW</Badge><span className="subtle">Prompt {index + 1} of {voicePrompts.length}</span></div>
      <progress className="progress" value={count} max={12} aria-label="Writing prompts answered" />
      <div className="prompt-picker" aria-label="Choose an interview prompt">{voicePrompts.map((entry, item) => <button key={entry.id} className={index === item ? "current" : (answers[entry.id]?.trim().length ?? 0) >= 20 ? "answered" : ""}
        aria-label={`Prompt ${item + 1}: ${entry.title}`} aria-current={index === item ? "step" : undefined} onClick={() => setIndex(item)}>{(answers[entry.id]?.trim().length ?? 0) >= 20 && index !== item ? <Check size={14} aria-hidden="true" /> : item + 1}</button>)}</div>
      <div className="voice-question"><p className="eyebrow">A LITTLE REFLECTION GOES A LONG WAY</p><h2>{prompt.title}</h2><p>{prompt.question}</p></div>
      {["pride", "challenge", "intro", "strength"].includes(prompt.id) && data.profile.facts.some((fact) => fact.state === "verified") && <div className="context-note"><strong>A starting point from your profile</strong><p>{data.profile.facts.find((fact) => fact.state === "verified")!.text}</p><small>Use this for inspiration. Your interview answer will not become a career fact.</small></div>}
      <Field label={`Your answer: ${prompt.title}`} hint="Write naturally. These samples guide tone only; they are never treated as factual career evidence."><textarea rows={8} maxLength={5000} value={answers[prompt.id] ?? ""} placeholder="In my own words..." onChange={(event) => setAnswers({ ...answers, [prompt.id]: event.target.value })} /></Field>
      <div className="between"><Button className="secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}><ArrowLeft size={16} aria-hidden="true" /> Previous</Button><span className="subtle">{count}/12 answered &middot; {words} words</span><Button className="secondary" disabled={index === voicePrompts.length - 1} onClick={() => setIndex(index + 1)}>Next prompt <ArrowRight size={16} aria-hidden="true" /></Button></div>
    </section>
      <aside className="voice-aside"><section className="card"><span className="icon-tile"><Sparkles aria-hidden="true" /></span><h2>A little polish.<br />Still entirely you.</h2><p>Choose how much refinement you are comfortable with. The local engine preserves wording; these preferences also guide optional model review.</p>
        <Field label="Writing polish"><select value={polish} onChange={(event) => setPolish(voiceSchema.shape.polish.parse(event.target.value))}>{voiceSchema.shape.polish.options.map((value) => <option key={value}>{value}</option>)}</select></Field>
        <Field label="Phrases you like" hint="Separate phrases with commas."><textarea rows={2} maxLength={4500} value={preferred} onChange={(event) => setPreferred(event.target.value)} placeholder="For example: make things simpler" /></Field>
        <Field label="Phrases to avoid" hint="Drafts containing these phrases cannot be approved."><textarea rows={2} maxLength={4500} value={banned} onChange={(event) => setBanned(event.target.value)} placeholder="For example: leverage synergies, rockstar" /></Field>
      </section><div className="card soft"><h3>Good enough to begin</h3><p>A local baseline needs at least 3 substantial answers and 80 words in total. All 12 prompts are recommended for richer context.</p><Badge tone={count >= 3 && words >= 80 ? "green" : "amber"}>{count >= 3 && words >= 80 ? "Ready to save a baseline" : "Keep the words coming"}</Badge><p className="subtle">This is a writing profile, not a personality assessment or AI detector.</p></div></aside>
    </fieldset>
    {action.feedback}
    <div className="save-bar"><span className="subtle">Every save creates a new version. Your approved packages keep their original voice snapshot.</span><div className="button-row"><Button className="secondary" loading={action.busy} onClick={() => { void action.run(async () => { setVersions(await api.request("/voice/versions", z.array(voiceSchema))); }); }}>Saved versions</Button><Button className="primary" loading={action.busy} onClick={() => {
      void action.run(async () => {
        const saved = await api.request("/voice", voiceSchema, { method: "POST", body: { answers: Object.entries(answers).filter(([, text]) => text.trim()).map(([promptId, text]) => ({ promptId, text })), polish, preferredPhrases: phrases(preferred), bannedPhrases: phrases(banned) } });
        setVersions((current) => current ? [saved, ...current] : null);
        await refresh(); if (saved.complete && data.profile.onboardingStep !== "complete") navigate("preferences");
      }, "Your writing profile was saved as a new version.");
    }}>{count >= 3 && words >= 80 ? "Save voice profile" : "Save interview draft"}<ArrowRight size={17} aria-hidden="true" /></Button></div></div>
    {versions && <section className="card"><h2>Saved writing profiles</h2>{!versions.length && <p>No versions saved yet.</p>}{versions.map((version) => <details className="version-row" key={version.id}><summary>Version {version.version} &middot; {date(version.createdAt)} &middot; {version.complete ? "Baseline ready" : "Draft"} &middot; {version.attributes.wordCount} words</summary>{version.answers.map((answer) => <div key={answer.promptId}><h3>{voicePrompts.find((entry) => entry.id === answer.promptId)?.title}</h3><p className="preserve-lines">{answer.text}</p></div>)}</details>)}</section>}
  </>;
}
