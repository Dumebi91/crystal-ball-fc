import type { Metadata } from 'next';
import { legalHtml } from '@/content/legal';

export const metadata: Metadata = { title: 'Terms of Use' };

// The text lives in src/content/terms.md; company details in src/content/legal.ts.
export default function Page() {
  return (
    <div className="wrap page" style={{ maxWidth: 760 }}>
      <h1 className="display d-l">Terms of Use</h1>
      <div className="legal" dangerouslySetInnerHTML={{ __html: legalHtml('terms') }} />
    </div>
  );
}
