/**
 * What ffwd can't do, stated plainly, with the nearest chore it can (when there is one) and a way to carry on.
 * @param {{ reason: string, nearestChore?: { name: string, href: string }, onNewRequest?: () => void }} props
 */
export default function Unsupported({ reason, nearestChore, onNewRequest }) {
  return (
    <div className="notice" role="status">
      <p className="notice__t">ffwd can't do this one yet</p>
      <p>{reason}</p>
      {nearestChore && (
        <p>
          The nearest thing it can do:{" "}
          <a href={nearestChore.href}>{nearestChore.name}</a>
        </p>
      )}
      {onNewRequest && (
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={onNewRequest}
        >
          Try another request
        </button>
      )}
    </div>
  );
}
