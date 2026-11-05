import type { Metadata } from 'next';
import { legalHtml } from '@/content/legal';

export const metadata: Metadata = { title: 'Privacy Policy' };

// The text lives in src/content/privacy.md; company details in src/content/legal.ts.
export default function Page() {
  return (
    <div className="wrap page" style={{ maxWidth: 760 }}>
      <h1 className="display d-l">Privacy Policy</h1>
      <div className="legal" dangerouslySetInnerHTML={{ __html: legalHtml('privacy') }} />
    </div>
  );
}
