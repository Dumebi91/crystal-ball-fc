import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';

// The Terms of Use and Privacy Policy live as plain text in src/content/terms.md and privacy.md.
// Fill these in once the company details are confirmed; the pages pick them up on the next deploy.
// Anything left empty is worded around, so no [blanks] ever show on the live site.
export const LEGAL = {
  updated: '5 November 2026',
  company: '',          // registered name, e.g. 'Crystal Ball FC Limited'
  rc: '',               // CAC RC number
  address: '',          // registered address from the CAC certificate
  dataContact: '',      // the person who answers privacy requests, e.g. 'Dumebi Malogo'
  liabilityCap: '',     // set by the lawyer, e.g. '₦50,000'
};

function operator(kind: 'privacy' | 'terms'): string {
  const { company, rc, address } = LEGAL;
  if (company) {
    const who = [company, rc && `(RC ${rc})`].filter(Boolean).join(' ') + (address ? `, ${address}` : '');
    return kind === 'privacy'
      ? `It is run by ${who} ("we", "us").`
      : `These terms are the agreement between you and ${who}, which runs Crystal Ball FC at crystalballfc.com ("we", "us").`;
  }
  return kind === 'privacy'
    ? 'It is run by the Crystal Ball FC team ("we", "us").'
    : 'These terms are the agreement between you and the team that runs Crystal Ball FC at crystalballfc.com ("we", "us").';
}

function fill(md: string, kind: 'privacy' | 'terms'): string {
  const { company, address, dataContact, liabilityCap, updated } = LEGAL;
  return md
    .replaceAll('{{UPDATED}}', updated)
    .replaceAll('{{OPERATOR}}', operator(kind))
    .replaceAll('{{DATA_CONTACT}}', dataContact
      ? `Our data protection contact is ${dataContact}, at privacy@crystalballfc.com.`
      : 'You can reach the person responsible for data protection at privacy@crystalballfc.com.')
    .replaceAll('{{LIABILITY}}', liabilityCap
      ? `Our total liability to you is limited to ${liabilityCap} or the value of any prize you've won from us, whichever is higher.`
      : "Our total liability to you is limited to the value of any prize you've won from us.")
    .replaceAll('{{POST}}', company && address ? `\n- Post: ${company}, ${address}` : '');
}

export function legalHtml(kind: 'privacy' | 'terms'): string {
  const md = fs.readFileSync(path.join(process.cwd(), 'src/content', `${kind}.md`), 'utf8');
  return marked.parse(fill(md, kind), { async: false }) as string;
}
