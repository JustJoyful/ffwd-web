import { REASON_TEXT } from "../../lib/capability.js";

/** Why this browser or device can't run ffwd, and what to do instead. @param {{ reason: string }} props */
export default function CapabilityNotice({ reason }) {
  return (
    <div className="notice notice--wide" role="alert">
      <p className="notice__t">ffwd can't run here</p>
      <p>{REASON_TEXT[reason] ?? reason}</p>
    </div>
  );
}
