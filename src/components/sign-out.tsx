"use client";
import { useState } from "react";
export function SignOut() {
  const [busy,setBusy] = useState(false);
  return <button className="text-button" disabled={busy} onClick={async () => {setBusy(true); try {const response=await fetch('/api/auth/logout',{method:'POST'}); if(response.ok) window.location.assign('/'); else setBusy(false);} catch {setBusy(false);}}}>{busy ? 'Signing out…' : 'Sign out'}</button>;
}
