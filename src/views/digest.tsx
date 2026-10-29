import type { NightDigest } from '../digest/types.js';

export function DigestPage({ digest }: { digest: NightDigest }) {
  return (
    <>
      <h1>digest · {digest.night}</h1>
      <p>bad lines: {digest.badLines}</p>
      <p>events: {digest.counts.ok} ok · {digest.counts.retry} retry · {digest.counts.fail} fail</p>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th><th>owner</th><th>runs</th><th>retries</th>
              <th>latest status</th><th>latest error</th><th>first</th><th>last</th><th>failed</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr>
                <td>{row.job}</td><td>{row.owner ?? '—'}</td><td>{row.runs}</td>
                <td class={row.retries >= 3 ? 'warn' : undefined}>{row.retries}{row.retries >= 3 ? ' ⚠' : ''}</td>
                <td>{row.lastStatus}</td><td>{row.lastError ?? '—'}</td>
                <td>{row.firstAt}</td><td>{row.lastAt}</td>
                <td class={row.hasFailed ? 'warn' : undefined}>{row.hasFailed ? 'yes ⚠' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
