"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, GitPullRequest, LoaderCircle, AlertCircle } from "lucide-react";
export function PrForm({initialUrl = "", enabledRepositories = []}: {initialUrl?: string; enabledRepositories?: string[]}) {
  const router = useRouter();
  const [mode, setMode] = useState<'number'|'url'>(initialUrl ? 'url' : 'number');
  const [url, setUrl] = useState(initialUrl);
  const [repository, setRepository] = useState(enabledRepositories.length === 1 ? enabledRepositories[0] : '');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const repo = repository.trim();
    if (mode === 'number' && (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !/^[1-9]\d*$/.test(number))) {setError('Enter a repository as owner/repository and a positive pull request number.'); return;}
    setBusy(true);
    const pullRequestUrl = mode === 'url' ? url.trim() : `https://github.com/${repo}/pull/${number}`;
    try {
      const response = await fetch("/api/assessments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pullRequestUrl }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || "We could not prepare this assessment. Please try again.");
      router.push(`/assessments/${data.id ?? data.assessment?.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Please try again."); setBusy(false); }
  }
  return <form onSubmit={submit} className="pr-form"><div className="mode-selector" role="group" aria-label="How to select your pull request"><button type="button" aria-pressed={mode==='number'} onClick={()=>setMode('number')} disabled={busy}>PR number</button><button type="button" aria-pressed={mode==='url'} onClick={()=>setMode('url')} disabled={busy}>PR URL</button></div>{mode === 'url' ? <><label htmlFor="pr-url">GitHub pull request URL</label><div className="input-wrap"><GitPullRequest size={19}/><input id="pr-url" type="url" required placeholder="https://github.com/owner/repository/pull/42" value={url} onChange={e => setUrl(e.target.value)} disabled={busy} autoComplete="off"/></div><p className="field-help">Paste the full link so we can identify the repository and PR.</p></> : <><label htmlFor="pr-repository">Repository</label><div className="input-wrap"><GitPullRequest size={19}/><input id="pr-repository" type="text" list="enabled-repositories" required pattern="[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+" placeholder="Mooroon5-CNP/repository" value={repository} onChange={e=>setRepository(e.target.value)} disabled={busy} autoComplete="off"/></div><datalist id="enabled-repositories">{enabledRepositories.map(repo=><option value={repo} key={repo}/>)}</datalist><div className="number-field"><label htmlFor="pr-number">Pull request number</label><div className="input-wrap"><span aria-hidden="true">#</span><input id="pr-number" type="number" min="1" step="1" required placeholder="42" value={number} onChange={e=>setNumber(e.target.value)} disabled={busy}/></div></div><p className="field-help">Choose a suggested repository or enter owner/repository.</p></>}{error && <div className="notice error" role="alert"><AlertCircle size={18}/><span>{error}</span></div>}<button className="button primary" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={18} className="spin"/> Preparing your assessment…</> : <>Prepare my assessment <ArrowRight size={18}/></>}</button>{busy && <p className="field-help" role="status">Reading the changes and generating your questions. This may take a moment.</p>}</form>;
}
