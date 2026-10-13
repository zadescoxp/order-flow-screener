"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Primitives";

const DISMISSED_KEY = "oft-bug-report-dialog-dismissed";
const ISSUE_URL = "https://github.com/zadescoxp/order-flow-screener/issues/new";
const X_URL = "https://x.com/intent/post?text=I%20found%20a%20bug%20in%20the%20Order%20Flow%20Terminal";

export default function BugReportDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(DISMISSED_KEY) !== "true") setOpen(true);
  }, []);

  const dismiss = () => {
    window.localStorage.setItem(DISMISSED_KEY, "true");
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="bug-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) dismiss();
    }}>
      <section className="bug-dialog" role="dialog" aria-modal="true" aria-labelledby="bug-dialog-title">
        <div className="bug-dialog-icon">!</div>
        <div className="bug-dialog-copy">
          <div className="ui-eyebrow">Help improve the terminal</div>
          <h2 id="bug-dialog-title">Want to report a bug?</h2>
          <p>Tell us what went wrong so we can make the market data experience better.</p>
          <div className="bug-dialog-actions">
            <a className="ui-button is-active" href={ISSUE_URL} target="_blank" rel="noreferrer" onClick={dismiss}>
              Raise an issue
            </a>
            <a className="ui-button" href={X_URL} target="_blank" rel="noreferrer" onClick={dismiss}>
              Send a DM on X
            </a>
          </div>
          <Button className="bug-dialog-later" onClick={dismiss}>Maybe later</Button>
        </div>
      </section>
    </div>
  );
}
