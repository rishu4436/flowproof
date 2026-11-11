import Link from "next/link";
import { Mark } from "@/components/mark";
import { LandingPreview } from "@/components/landing-preview";

export default function LandingPage() {
  return (
    <div className="landing">
      <header>
        <Link href="/" className="row"><Mark size={32} /><strong>FlowProof</strong></Link>
        <nav className="row">
          <a href="#problem">Problem</a>
          <a href="#how">How it works</a>
          <a href="#receipts">Receipts</a>
          <Link href="/help">Docs</Link>
          <Link className="btn primary" href="/overview">Open Studio</Link>
        </nav>
      </header>
      <section className="hero">
        <div>
          <div className="kicker">Browser automation with evidence</div>
          <h1>Automation you can prove.</h1>
          <p className="lede">Build browser workflows with AI. Recover when interfaces change. Verify that the outcome actually happened.</p>
          <div className="row">
            <Link className="btn primary" href="/workflows/wf_invoice">Open Studio</Link>
            <Link className="btn" href="/demo">Explore Live Demo</Link>
          </div>
        </div>
        <LandingPreview />
      </section>
      <section className="section" id="problem">
        <div className="kicker">The gap</div>
        <h2>A click is not a completed business outcome.</h2>
        <div className="cards" style={{ marginTop: 14 }}>
          <article className="panel"><h2>Action completed</h2><p>The agent clicked Submit Invoice and the button responded.</p></article>
          <article className="panel"><h2>Page reported success</h2><p>A toast said the invoice was submitted. That is supporting evidence only.</p></article>
          <article className="panel"><h2>Record verified</h2><p>FlowProof reads the saved invoice and compares it with the request. Missing records stay unverified or failed.</p></article>
        </div>
      </section>
      <section className="section" id="how">
        <div className="kicker">Method</div>
        <h2>Describe, build, execute, verify, recover.</h2>
        <div className="cards" style={{ marginTop: 14 }}>
          {["Describe the objective", "Build an approved graph", "Execute in an isolated browser", "Verify authoritative state", "Recover inside the authorized target"].map((item) => (
            <article key={item} className="panel"><h2>{item}</h2></article>
          ))}
        </div>
      </section>
      <section className="section">
        <div className="kicker">Who it is for</div>
        <div className="cards">
          <article className="panel"><h2>Finance operations</h2><p>Invoice and portal tasks where a false success is expensive.</p></article>
          <article className="panel"><h2>Automation engineers</h2><p>Selector drift, replay, and a record of what the repair changed.</p></article>
          <article className="panel"><h2>Agent developers</h2><p>Otari plans and repairs. Deterministic policy still decides.</p></article>
        </div>
      </section>
      <section className="section" id="receipts">
        <div className="kicker">Open infrastructure</div>
        <p className="lede">Playwright runs the browser. Mozilla Otari is the only inference gateway. The first target is the local Northstar Vendor Portal. FlowProof does not claim a connected bank, a hosted login product, or a benchmark it has not measured.</p>
        <div className="row">
          <Link className="btn primary" href="/workflows/wf_invoice">Open the Studio</Link>
          <Link className="btn" href="/demo">Try the demo</Link>
        </div>
      </section>
      <footer>
        <span>FlowProof · synthetic data only</span>
        <span className="row"><Link href="/help">Documentation</Link><Link href="/overview">Workspace</Link></span>
      </footer>
    </div>
  );
}
