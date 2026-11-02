import { useState } from "react";
import { fromKey, longDate } from "../lib/dates";
import { formatMinutes } from "../lib/stats";
import { COMPREHENSION_LABELS, type Session } from "../lib/types";

const PAGE_SIZE = 15;

export function History(props: {
  sessions: Session[];
  onEdit: (session: Session) => void;
  onDelete: (session: Session) => void;
}) {
  const { sessions, onEdit, onDelete } = props;
  const [visible, setVisible] = useState(PAGE_SIZE);

  // Array order is insertion order, so this keeps same-day sessions newest first.
  const sorted = [...sessions].reverse().sort((a, b) => b.date.localeCompare(a.date));

  if (sorted.length === 0) {
    return <p className="empty">Your sessions will show up here.</p>;
  }

  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Title</th>
              <th className="wide-only">Type</th>
              <th className="num">Time</th>
              <th className="wide-only">Understood</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, visible).map((s) => (
              <tr key={s.id}>
                <td className="nowrap">{longDate(fromKey(s.date))}</td>
                <td>{s.title || <span className="secondary">{s.category}</span>}</td>
                <td className="wide-only">{s.category}</td>
                <td className="num">{formatMinutes(s.minutes)}</td>
                <td className="wide-only">
                  {s.comprehension ? COMPREHENSION_LABELS[s.comprehension - 1] : "—"}
                </td>
                <td className="row-actions">
                  <button type="button" className="ghost" onClick={() => onEdit(s)}>Edit</button>
                  <button type="button" className="ghost" onClick={() => onDelete(s)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible < sorted.length && (
        <button type="button" className="show-more" onClick={() => setVisible(visible + PAGE_SIZE)}>
          Show more ({sorted.length - visible} left)
        </button>
      )}
    </>
  );
}
