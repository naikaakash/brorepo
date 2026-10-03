import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, FileText, Fingerprint, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { policyVersion, z } from "@applymate/contracts";
import { api, successSchema } from "./api";
import { Badge, Brand, Button, Field, Notice } from "./ui";
import { useAction } from "./hooks";

const letterSchema = z.object({ code: z.string().regex(/^\d{6}$/), expiresAt: z.string(), notice: z.string() });
const signInSchema = z.object({ user: z.object({ id: z.string(), email: z.email() }), token: z.string() });

export function Auth({ mailMode, signedIn, publicPreview = false }: { mailMode: "local" | "smtp"; signedIn: () => Promise<void>; publicPreview?: boolean }) {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [consent, setConsent] = useState(false);
  const [sent, setSent] = useState(false);
  const [preview, setPreview] = useState("");
  const emailInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const previouslySent = useRef(false);
  const action = useAction();
  useEffect(() => {
    if (sent) codeInput.current?.focus();
    else if (previouslySent.current) emailInput.current?.focus();
    previouslySent.current = sent;
  }, [sent]);
  return <div className="landing">
    <header className="landing-nav"><a href="#welcome" aria-label="ApplyMate home"><Brand /></a><Badge><span className="status-dot" /> {publicPreview ? "Public frontend preview" : "Local preview"}</Badge></header>
    <main className="landing-main">
      <section className="landing-story">
        <p className="eyebrow"><Sparkles size={16} aria-hidden="true" /> YOUR NEXT CHAPTER STARTS WITH YOU</p>
        <h1>Your experience.<br />Your voice.<br /><span>Your next move.</span></h1>
        <p className="landing-description">A thoughtful home for your job search. Turn your resume into a living profile, connect your experience to the right opportunities, and show up as yourself.</p>
        <div className="identity-art" aria-label="Facts, voice, and preferences form your candidate profile">
          <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
          <div className="art-core"><Fingerprint size={55} strokeWidth={1.25} aria-hidden="true" /><strong>Uniquely you.</strong><span>Your candidate profile</span></div>
          <span className="art-chip chip-facts"><FileText size={18} aria-hidden="true" /> Verified facts <Check size={15} aria-hidden="true" /></span>
          <span className="art-chip chip-voice"><Sparkles size={18} aria-hidden="true" /> Your natural voice</span>
          <span className="art-chip chip-trust"><ShieldCheck size={18} aria-hidden="true" /> Always your approval</span>
        </div>
        <div className="trust-line"><ShieldCheck size={18} aria-hidden="true" /><span>No invented experience. No silent submissions. No analytics.</span></div>
      </section>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="icon-tile"><ArrowRight size={25} aria-hidden="true" /></div>
        <Badge tone="purple">RESUME-FIRST, HUMAN-ALWAYS</Badge>
        <h2 id="auth-title">{sent ? "Check your code" : "Meet your next chapter."}</h2>
        <p>{sent ? `Continue with the one-time code for ${email}.` : "Start with what you already have. A resume, a story, and somewhere you want to go."}</p>
        {publicPreview ? <div>
          <Notice>This is a public frontend preview. Sign-in, resume uploads, saved profiles, and document generation are available in the local full-stack build, not on this static site.</Notice>
          <p>The integrated local workflow includes confirmed candidate facts, writing-voice onboarding, job evidence mapping, reviewed PDF and Word exports, and manual application tracking.</p>
          <a className="button primary full" href="https://github.com/naikaakash/brorepo/tree/feat/applymate">View source &amp; local setup <ArrowRight size={18} aria-hidden="true" /></a>
          <p>No account or personal information is collected by this preview. Public account features require a production backend and delivered-email verification.</p>
        </div> : <><form onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            if (!sent) {
              await api.request("/auth/email-otp/send-verification-otp", successSchema, { method: "POST", body: { email: email.trim(), type: "sign-in" } });
              setSent(true);
            } else {
              await api.request("/auth/sign-in/email-otp", signInSchema, {
                method: "POST", body: { email: email.trim(), otp },
                headers: { "X-Applymate-Consent": policyVersion }
              });
              await signedIn();
            }
          });
        }}>
          {!sent ? <>
            <Field label="Email address"><input ref={emailInput} type="email" autoComplete="email" required readOnly={action.busy} maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></Field>
            <label className="check-row"><input type="checkbox" checked={consent} disabled={action.busy} onChange={(event) => setConsent(event.target.checked)} required /><span>I understand this is a local evaluation. My profile and files will be saved on this computer until I delete them.</span></label>
          </> : <>
            <Field label="Verification code" hint="Six digits. Valid for 10 minutes."><input ref={codeInput} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required readOnly={action.busy} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} placeholder="000000" /></Field>
            {mailMode === "local" && <div className="local-mail">
              <p><strong>Local development inbox</strong><br />No email was delivered. This preview does not prove email ownership.</p>
              <Button className="secondary full" loading={action.busy} onClick={() => {
                void action.run(async () => {
                  const letter = await api.request("/local-mail", letterSchema, { method: "POST", body: { email: email.trim() } });
                  setPreview(letter.code); setOtp(letter.code);
                });
              }}>Open local email preview</Button>
              {preview && <output className="otp-preview" aria-label="Local verification code">{preview}</output>}
            </div>}
          </>}
          {action.feedback}
          <Button type="submit" className="primary full" loading={action.busy} disabled={!consent}>{sent ? "Verify and continue" : "Send sign-in code"}<ArrowRight size={18} aria-hidden="true" /></Button>
          {sent && <div className="button-row"><Button className="text-button" disabled={action.busy} onClick={() => { setSent(false); setOtp(""); setPreview(""); }}>Use another email</Button>
            <Button className="text-button" loading={action.busy} onClick={() => {
              void action.run(async () => {
                await api.request("/auth/email-otp/send-verification-otp", successSchema, { method: "POST", body: { email: email.trim(), type: "sign-in" } });
                setPreview(""); setOtp("");
              }, mailMode === "local" ? "A new code is in the local development inbox." : "A new code has been requested.");
            }}>Request a new code</Button></div>}
        </form>
        {!sent && mailMode === "local" && <Notice>This build uses a local email preview, not delivered email. No cloud account is required.</Notice>}
        <div className="auth-footer"><LockKeyhole size={15} aria-hidden="true" /><span>Passwordless. Private to this local workspace.<br />No third-party AI calls unless you configure and choose a provider.</span></div></>}
      </section>
    </main>
    <footer className="landing-footer"><span>Built around your story, not a template.</span><span>Personal learning preview &middot; {publicPreview ? "Frontend only" : "Not a public service"}</span></footer>
  </div>;
}
