import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy Policy' };

// TODO before launch: paste the lawyer-approved text from the "Crystal Ball FC Privacy Policy and Terms" doc.
export default function Page() {
  return (
    <div className="wrap page" style={{ maxWidth: 760 }}>
      <h1 className="display d-l">Privacy Policy</h1>
      <p className="muted" style={{ marginTop: 16 }}>Final text coming before launch.</p>
    </div>
  );
}
