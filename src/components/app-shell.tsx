import Link from "next/link";
import { SignOut } from "./sign-out";
import { GitPullRequest, ArrowUpRight, ShieldCheck } from "lucide-react";
export function AppShell({ children, signedIn = false }: { children: React.ReactNode; signedIn?: boolean }) {
  return <><header className="topbar"><Link href="/" className="brand"><span className="brand-icon"><GitPullRequest size={21}/></span><span>PR Understanding<span className="brand-sub">KNOW WHAT YOU SHIP</span></span></Link><nav aria-label="Main navigation"><a href="https://github.com/Mooroon5-CNP" target="_blank" rel="noreferrer" className="org-link">Mooroon5-CNP <ArrowUpRight size={14}/></a>{signedIn && <SignOut/>}</nav></header><main>{children}</main><footer className="footer"><span><ShieldCheck size={14}/> Graded on the server. Verified on GitHub.</span><span>Built for understanding, before merging.</span></footer></>;
}
