'use strict';
// The competence bench — Chambers' own bar.
//
// The model gateway accepts ANY OpenAI-compatible endpoint, and the admin page
// deliberately suggests a small local model (privacy: nothing leaves the
// building). That is the right default for confidentiality — and it means the
// firm may be taking drafting and research suggestions from a model nobody has
// ever measured. This module measures it: 48 original bar-style questions of
// black-letter Ontario/Canadian law, sent through the SAME transport the rooms
// use, scored strictly, with a pass line the firm can see on /admin.
//
// What a passing score means: the configured model can answer settled doctrine
// correctly at bar-exam style. What it does NOT mean: that the model is a
// lawyer, that its output is legal advice, or that anything it writes can skip
// the citation gate and human verification. No score moves responsibility off
// the licensee — this bench exists so the tool's floor is measured instead of
// assumed. The questions are original to Chambers (authored and independently
// reviewed for accuracy); they are in the STYLE of licensing-exam questions and
// are affiliated with no law society or examiner.
//
// Answers must never be trainable-from or leak: the bank ships with the app,
// contains no client content, and the bench sends only these fixed public
// questions — never matter data.

const PASS_LINE = 0.75; // Chambers' own line — stricter than typical raw passing marks.

// Each: { id, subject, q, options: {A,B,C,D}, answer, why, cite }
const BANK = [
  // ---- Limitations & deadlines (Ontario) -----------------------------------
  { id: 'lim-1', subject: 'Limitations', answer: 'B',
    q: 'Under the Limitations Act, 2002 (Ontario), the basic limitation period for a civil claim is:',
    options: { A: 'Six years from the events giving rise to the claim', B: 'Two years from the day the claim was discovered', C: 'One year from the day the claim arose', D: 'Ten years from the act or omission' },
    why: 'Section 4 sets a basic period of two years running from discovery, not from the events themselves.',
    cite: 'Limitations Act, 2002, SO 2002, c 24, Sch B, s 4' },
  { id: 'lim-2', subject: 'Limitations', answer: 'C',
    q: 'The ultimate limitation period in Ontario, after which most claims are barred regardless of discoverability, is:',
    options: { A: 'Twenty years from discovery', B: 'Ten years from the act or omission', C: 'Fifteen years from the day the act or omission took place', D: 'There is no ultimate period; discoverability always governs' },
    why: 'Section 15 bars the claim fifteen years after the act or omission, whether or not it has been discovered.',
    cite: 'Limitations Act, 2002, s 15' },
  { id: 'lim-3', subject: 'Limitations', answer: 'A',
    q: 'A claim is "discovered" under the Limitations Act, 2002 on the first day the claimant knew or ought reasonably to have known:',
    options: { A: 'That injury occurred, that it was caused by the defendant’s act or omission, and that a proceeding would be an appropriate remedy', B: 'Only that some injury had occurred', C: 'That the defendant carried liability insurance', D: 'That the damages would exceed the Small Claims Court limit' },
    why: 'Section 5(1)(a) lists the elements, including that a proceeding would be an appropriate means to remedy the injury.',
    cite: 'Limitations Act, 2002, s 5(1)' },
  { id: 'lim-4', subject: 'Limitations', answer: 'D',
    q: 'While a claimant is a minor and not represented by a litigation guardian, the basic limitation period:',
    options: { A: 'Runs normally', B: 'Is shortened to one year', C: 'Runs but may be extended by the court for special circumstances', D: 'Does not run' },
    why: 'Section 6 suspends the running of time while the claimant is a minor not represented by a litigation guardian.',
    cite: 'Limitations Act, 2002, s 6' },
  { id: 'lim-5', subject: 'Limitations', answer: 'B',
    q: 'A written acknowledgment of liability in respect of a claim for a liquidated sum, signed before the limitation period expires, has what effect?',
    options: { A: 'None; limitation periods cannot be affected by the parties', B: 'The basic limitation period restarts from the date of the acknowledgment', C: 'The claim becomes subject to the ultimate period only', D: 'The claim is converted into a demand obligation with no limitation period' },
    why: 'Section 13 restarts the clock on an acknowledgment of liability meeting its formal requirements.',
    cite: 'Limitations Act, 2002, s 13' },
  { id: 'lim-6', subject: 'Limitations', answer: 'C',
    q: 'A pedestrian injured by a failure to keep a municipal sidewalk in repair must, to preserve the claim against the municipality:',
    options: { A: 'Sue within six months', B: 'Obtain leave of the court before issuing a claim', C: 'Give written notice of the claim to the municipality within 10 days of the injury, subject to a reasonable-excuse saving', D: 'Nothing beyond the ordinary two-year limitation period' },
    why: 'Section 44(10) of the Municipal Act, 2001 requires 10-day written notice for nonrepair claims; failure bars the action unless excused with no prejudice.',
    cite: 'Municipal Act, 2001, SO 2001, c 25, s 44(10)' },

  // ---- Civil procedure (Ontario Rules) -------------------------------------
  { id: 'civ-1', subject: 'Civil procedure', answer: 'A',
    q: 'A defendant served with a statement of claim in Ontario must deliver a statement of defence within:',
    options: { A: 'Twenty days after service', B: 'Ten days after service', C: 'Thirty days after service', D: 'Sixty days after service' },
    why: 'Rule 18.01(a): twenty days where the defendant is served in Ontario (longer periods apply to service elsewhere).',
    cite: 'Rules of Civil Procedure, RRO 1990, Reg 194, r 18.01' },
  { id: 'civ-2', subject: 'Civil procedure', answer: 'D',
    q: 'After a statement of claim is issued, it must be served on each defendant within:',
    options: { A: 'Thirty days', B: 'Ninety days', C: 'One year', D: 'Six months' },
    why: 'Rule 14.08(1) requires service within six months of issuance, extendable by the court.',
    cite: 'Rules of Civil Procedure, r 14.08(1)' },
  { id: 'civ-3', subject: 'Civil procedure', answer: 'B',
    q: 'A plaintiff makes a Rule 49 offer that the defendant does not accept. The plaintiff then obtains judgment as favourable as the offer or better. The usual costs consequence is:',
    options: { A: 'Full indemnity costs of the whole action', B: 'Partial indemnity costs to the date the offer was served, and substantial indemnity costs from that date', C: 'No effect on costs; offers are relevant only to prejudgment interest', D: 'Substantial indemnity costs of the whole action' },
    why: 'Rule 49.10(1) sets exactly that split as the default, subject to the court ordering otherwise.',
    cite: 'Rules of Civil Procedure, r 49.10(1)' },
  { id: 'civ-4', subject: 'Civil procedure', answer: 'C',
    q: 'Following Hryniak v. Mauldin, on a summary judgment motion the court:',
    options: { A: 'Must dismiss the motion whenever credibility is in issue', B: 'May grant judgment only where the record equals what a trial would produce', C: 'May weigh evidence, evaluate credibility and draw inferences, and should grant judgment where the process allows fair and just adjudication without trial', D: 'Must direct a mini-trial in every contested case' },
    why: 'Hryniak held the enhanced powers in r 20.04(2.1) may be used unless the interest of justice requires trial; there is no genuine issue requiring a trial where summary process gives fair and just adjudication.',
    cite: 'Hryniak v Mauldin, 2014 SCC 7; r 20.04(2.1)' },
  { id: 'civ-5', subject: 'Civil procedure', answer: 'A',
    q: 'Before documentary and oral discovery proceed in an ordinary Ontario action, the parties are required to:',
    options: { A: 'Agree to a discovery plan, updated as circumstances change', B: 'Obtain a discovery order from a case-management judge', C: 'Exchange sworn witness statements', D: 'Attend mandatory mediation' },
    why: 'Rule 29.1.03 requires the parties to agree to a discovery plan; a party who fails to participate risks costs and other sanctions.',
    cite: 'Rules of Civil Procedure, r 29.1.03' },
  { id: 'civ-6', subject: 'Civil procedure', answer: 'D',
    q: 'A jury notice in a civil action in Ontario must be delivered:',
    options: { A: 'With the trial record', B: 'At any time before the pre-trial conference', C: 'Only with leave of the trial judge', D: 'Before the close of pleadings' },
    why: 'Rule 47.01 permits a jury notice before the close of pleadings, in actions where a jury is available under the Courts of Justice Act.',
    cite: 'Rules of Civil Procedure, r 47.01; Courts of Justice Act, s 108' },

  // ---- Trust accounting & professional responsibility (LSO) ----------------
  { id: 'pro-1', subject: 'Professional responsibility', answer: 'B',
    q: 'A licensee holds $5,000 in trust for client A and $20,000 for client B in a mixed trust account. A disbursement of $8,000 is to be paid for client A. The licensee may:',
    options: { A: 'Pay it from the trust account, since the account holds more than $8,000', B: 'Not pay more than $5,000 from trust for client A; no client’s trust money may fund another client’s matter', C: 'Pay it if client B consents informally', D: 'Pay it and replenish the shortfall within 30 days' },
    why: 'By-Law 9 permits paying out for a client only up to what is held for that client; using another client’s funds is misapplication regardless of the account’s total.',
    cite: 'LSO By-Law 9, s 7; mirrored by Chambers’ overdraw gate' },
  { id: 'pro-2', subject: 'Professional responsibility', answer: 'A',
    q: 'The required trust comparison (three-way reconciliation) for a licensee’s mixed trust account must be prepared:',
    options: { A: 'Monthly, comparing the trust ledgers, the total of client trust liabilities, and the bank statement balance', B: 'Annually, at fiscal year end', C: 'Only when the Law Society conducts a spot audit', D: 'Quarterly, unless the account is inactive' },
    why: 'By-Law 9 requires a monthly comparison of the three positions; a discrepancy must be investigated and corrected.',
    cite: 'LSO By-Law 9, s 18; mirrored by room 28’s three-way check' },
  { id: 'pro-3', subject: 'Professional responsibility', answer: 'C',
    q: 'The cash a licensee may accept in respect of any one client file is limited to:',
    options: { A: 'No limit, provided it is deposited to trust within one banking day', B: '$10,000 per retainer', C: 'Less than $7,500; receiving $7,500 or more in cash on a file is prohibited subject to narrow exceptions', D: '$2,500 per calendar year per client' },
    why: 'By-Law 9’s cash transaction rules prohibit accepting an aggregate of $7,500 or more in cash for one client file, with limited exceptions.',
    cite: 'LSO By-Law 9, Part III' },
  { id: 'pro-4', subject: 'Professional responsibility', answer: 'D',
    q: 'Fees may be transferred from trust to a licensee’s general account:',
    options: { A: 'As soon as the work is done', B: 'On the client’s oral authorization', C: 'Monthly by standing arrangement', D: 'Only for fees earned and after a bill has been delivered to the client' },
    why: 'Trust money becomes the licensee’s only when earned and billed; the transfer follows delivery of the account.',
    cite: 'LSO By-Law 9; RPC commentary on fees from trust' },
  { id: 'pro-5', subject: 'Professional responsibility', answer: 'A',
    q: 'Under the bright-line rule for conflicts of interest, a lawyer:',
    options: { A: 'Cannot act directly adverse to the immediate legal interests of a current client without the clients’ consent, even on an unrelated matter', B: 'May act against a current client on any unrelated matter', C: 'Is only barred from acting against former clients', D: 'May act adverse to a current client whenever no confidential information is at risk' },
    why: 'R v Neil and CN Rail v McKercher: acting directly adverse to a current client’s immediate interests breaches loyalty even without confidential information at risk, absent consent.',
    cite: 'R v Neil, 2002 SCC 70; McKercher, 2013 SCC 39' },
  { id: 'pro-6', subject: 'Professional responsibility', answer: 'B',
    q: 'A lawyer’s duty of confidentiality to a client:',
    options: { A: 'Ends when the retainer ends', B: 'Continues indefinitely, surviving the end of the retainer and the death of the client', C: 'Ends when the file is destroyed under a retention schedule', D: 'May be waived by the lawyer on reasonable notice' },
    why: 'The duty survives the retainer and the client; only the client (or their estate/lawful authority) can waive it.',
    cite: 'RPC r 3.3-1, commentary' },

  // ---- Privilege ------------------------------------------------------------
  { id: 'prv-1', subject: 'Privilege', answer: 'C',
    q: 'Solicitor-client privilege attaches to a communication when it is:',
    options: { A: 'Any communication between a lawyer and any person', B: 'Any document in a lawyer’s file', C: 'A communication between lawyer and client, made in confidence, for the purpose of seeking or giving legal advice', D: 'Any communication marked "privileged and confidential"' },
    why: 'The three elements are lawyer-client communication, confidentiality, and the purpose of legal advice; labels neither create nor defeat it.',
    cite: 'Solosky v The Queen, [1980] 1 SCR 821' },
  { id: 'prv-2', subject: 'Privilege', answer: 'B',
    q: 'Litigation privilege differs from solicitor-client privilege in that litigation privilege:',
    options: { A: 'Belongs to the lawyer rather than the client', B: 'Covers material created for the dominant purpose of litigation and ends when the litigation and closely related proceedings end', C: 'Is absolute and permanent', D: 'Requires that a lawyer author the document' },
    why: 'Blank v Canada: dominant-purpose test, protection expires with the litigation; it protects the adversarial process, not the advice relationship.',
    cite: 'Blank v Canada (Minister of Justice), 2006 SCC 39' },
  { id: 'prv-3', subject: 'Privilege', answer: 'A',
    q: 'Solicitor-client privilege belongs to, and may be waived by:',
    options: { A: 'The client alone', B: 'The lawyer alone', C: 'Either the lawyer or the client', D: 'The court, in the interests of justice' },
    why: 'The privilege is the client’s; the lawyer asserts it on the client’s behalf and cannot waive it over the client’s objection.',
    cite: 'Lavallee, Rackel & Heintz, 2002 SCC 61' },
  { id: 'prv-4', subject: 'Privilege', answer: 'D',
    q: 'Two parties with a common interest in anticipated litigation share privileged material between themselves under a common-interest arrangement. The effect on privilege as against outsiders is:',
    options: { A: 'Privilege is waived entirely', B: 'Privilege survives only if a court approves the sharing in advance', C: 'The material becomes litigation-privileged only', D: 'Privilege is maintained; sharing within the common interest is not a waiver as against strangers to it' },
    why: 'Common-interest doctrine: disclosure within the circle of common interest does not waive privilege against the rest of the world.',
    cite: 'Pritchard v Ontario (HRC), 2004 SCC 31 (discussion); appellate authority on common interest' },
  { id: 'prv-5', subject: 'Privilege', answer: 'B',
    q: 'A client consults a lawyer to structure a transaction the client intends as a fraud. Those communications are:',
    options: { A: 'Privileged, because privilege is nearly absolute', B: 'Not privileged; communications in furtherance of crime or fraud fall outside the privilege', C: 'Privileged unless the lawyer knew of the fraud', D: 'Protected by litigation privilege only' },
    why: 'The crime/fraud exception: privilege never attaches to communications made to facilitate unlawful conduct, whatever the lawyer knew.',
    cite: 'Descôteaux v Mierzwinski, [1982] 1 SCR 860' },
  { id: 'prv-6', subject: 'Privilege', answer: 'A',
    q: 'A relationship not covered by a class privilege may still attract privilege case-by-case if it meets the Wigmore criteria, which require among other things that:',
    options: { A: 'The communication originated in a confidence, confidentiality is essential to the relationship, the relationship is one the community values, and the injury from disclosure would outweigh the benefit to litigation', B: 'The parties signed a non-disclosure agreement', C: 'A statute designates the relationship as privileged', D: 'The communication was made to a regulated professional' },
    why: 'The four Wigmore conditions govern case-by-case privilege claims (e.g., religious or journalist-source contexts).',
    cite: 'R v Gruenke, [1991] 3 SCR 263' },

  // ---- Evidence --------------------------------------------------------------
  { id: 'evd-1', subject: 'Evidence', answer: 'D',
    q: 'Under the principled approach, hearsay is admissible when the party tendering it establishes, on a voir dire:',
    options: { A: 'Relevance alone', B: 'That the declarant is unavailable, in every case', C: 'That the statement fits a traditional exception', D: 'Necessity and threshold reliability' },
    why: 'Khelawon: the twin criteria are necessity and threshold reliability; traditional exceptions remain but must conform to the principled approach.',
    cite: 'R v Khelawon, 2006 SCC 57' },
  { id: 'evd-2', subject: 'Evidence', answer: 'C',
    q: 'A witness’s prior inconsistent statement may be admitted for the truth of its contents when:',
    options: { A: 'Never; it goes only to credibility', B: 'The statement was made closer in time to the events', C: 'It carries sufficient indicia of reliability — such as an oath or solemn affirmation, a video record, and the availability of the declarant for cross-examination — and is necessary', D: 'Both parties consent' },
    why: 'R v B (KG): with those safeguards the statement may be received substantively under the principled approach.',
    cite: 'R v B (KG), [1993] 1 SCR 740' },
  { id: 'evd-3', subject: 'Evidence', answer: 'A',
    q: 'Business records are admissible as an exception to hearsay where:',
    options: { A: 'The record was made in the usual and ordinary course of business, and it was in the usual course to make it, subject to the statutory notice and conditions', B: 'Any employee swears the record looks accurate', C: 'The record is computerized', D: 'The opposing party fails to object before trial' },
    why: 'Ontario Evidence Act s 35 / Canada Evidence Act s 30 admit records made in the ordinary course, on notice, without calling every author.',
    cite: 'Evidence Act (Ontario), s 35; CEA, s 30' },
  { id: 'evd-4', subject: 'Evidence', answer: 'B',
    q: 'Similar fact evidence tendered by the prosecution is:',
    options: { A: 'Admissible whenever logically relevant', B: 'Presumptively inadmissible, admitted only where its probative value on a specific issue outweighs its prejudicial effect', C: 'Always inadmissible', D: 'Admissible only with the accused’s consent' },
    why: 'R v Handy: propensity evidence is presumptively excluded; the Crown must show probative value on an issue in question outweighing prejudice.',
    cite: 'R v Handy, 2002 SCC 56' },
  { id: 'evd-5', subject: 'Evidence', answer: 'A',
    q: 'Expert opinion evidence is admitted only where the threshold requirements are met and the gatekeeper is satisfied. The threshold requirements are:',
    options: { A: 'Relevance, necessity in assisting the trier of fact, absence of an exclusionary rule, and a properly qualified expert', B: 'Peer-reviewed publication of the expert’s method', C: 'That the expert has testified before', D: 'Agreement of both parties on the expert’s qualifications' },
    why: 'Mohan sets the four threshold criteria; White Burgess adds scrutiny of the expert’s independence and impartiality at the gatekeeping stage.',
    cite: 'R v Mohan, [1994] 2 SCR 9; White Burgess, 2015 SCC 23' },
  { id: 'evd-6', subject: 'Evidence', answer: 'C',
    q: 'Leading questions are generally:',
    options: { A: 'Prohibited in cross-examination', B: 'Permitted in examination-in-chief on contested matters', C: 'Prohibited in examination-in-chief on contested matters, but permitted in cross-examination', D: 'Prohibited everywhere except re-examination' },
    why: 'Counsel may not lead their own witness on matters in dispute; cross-examiners may lead freely.',
    cite: 'Ordinary trial practice; see e.g. R v Rose (2001), Ont CA discussion' },

  // ---- Contracts -------------------------------------------------------------
  { id: 'con-1', subject: 'Contracts', answer: 'B',
    q: 'A promises B $1,000 "in recognition of the help you gave me last month." The promise is:',
    options: { A: 'Enforceable, because the help was valuable', B: 'Unenforceable for want of consideration; past consideration is no consideration', C: 'Enforceable if made in writing', D: 'Enforceable as promissory estoppel' },
    why: 'Consideration must move in exchange for the promise; something already done cannot support a later promise.',
    cite: 'Eastwood v Kenyon; standard doctrine' },
  { id: 'con-2', subject: 'Contracts', answer: 'D',
    q: 'Promissory estoppel in Canadian contract law may be used:',
    options: { A: 'To found a cause of action where none exists', B: 'Only in commercial dealings', C: 'Only where the representation was in writing', D: 'As a defence — a shield, not a sword — where a party has relied on a promise not to enforce strict rights' },
    why: 'Combe v Combe: estoppel prevents enforcement of strict rights after a relied-upon promise; it does not create new causes of action.',
    cite: 'Combe v Combe, [1951] 2 KB 215; adopted in Canada' },
  { id: 'con-3', subject: 'Contracts', answer: 'A',
    q: 'A clause fixing damages payable on breach is enforceable as liquidated damages where it is:',
    options: { A: 'A genuine pre-estimate of the loss, judged at the time of contracting, and not oppressive', B: 'Less than the innocent party’s actual loss', C: 'Described in the contract as "liquidated damages"', D: 'Approved by the court before signing' },
    why: 'The genuine pre-estimate/oppression analysis governs; the label the parties chose does not.',
    cite: 'Shatilla v Feinstein; Elsley v JG Collins, [1978] 2 SCR 916' },
  { id: 'con-4', subject: 'Contracts', answer: 'C',
    q: 'Under Tercon, a party resisting enforcement of an exclusion clause must show:',
    options: { A: 'Fundamental breach', B: 'That the clause was not initialled', C: 'That the clause does not apply on its interpretation, or was unconscionable at formation, or that overriding public policy outweighs enforcement', D: 'That the clause is in fine print' },
    why: 'Tercon replaced fundamental breach with the three-part framework: interpretation, unconscionability at formation, public policy.',
    cite: 'Tercon Contractors v BC, 2010 SCC 4' },
  { id: 'con-5', subject: 'Contracts', answer: 'B',
    q: 'Frustration discharges a contract where:',
    options: { A: 'Performance has become more expensive than expected', B: 'A supervening event, without the fault of either party and not contemplated by the contract, makes performance radically different from what was undertaken', C: 'One party changes its mind for good commercial reasons', D: 'Both parties made a common error about existing facts' },
    why: 'The radical-difference test; hardship or bad bargains do not frustrate. (A common mistake about existing facts is a different doctrine.)',
    cite: 'Naylor Group v Ellis-Don, 2001 SCC 58' },
  { id: 'con-6', subject: 'Contracts', answer: 'A',
    q: 'Damages for breach of contract are recoverable under Hadley v Baxendale where the loss:',
    options: { A: 'Arises naturally from the breach, or was within the parties’ reasonable contemplation at contracting as the probable result of breach', B: 'Was actually foreseen by the breaching party at the time of breach', C: 'Is proven with mathematical certainty', D: 'Was insured against' },
    why: 'The two limbs: losses in the usual course, and unusual losses within the parties’ contemplation when the contract was made.',
    cite: 'Hadley v Baxendale (1854); Fidler v Sun Life, 2006 SCC 30' },

  // ---- Torts -----------------------------------------------------------------
  { id: 'tor-1', subject: 'Torts', answer: 'C',
    q: 'Whether a novel duty of care exists in Canadian negligence law is determined by:',
    options: { A: 'Foreseeability alone', B: 'Whether insurance is available', C: 'The Anns/Cooper framework: reasonable foreseeability and proximity, then residual policy considerations', D: 'Whether Parliament has legislated a duty' },
    why: 'Cooper v Hobart structures the analysis in two stages, with policy able to negate a prima facie duty.',
    cite: 'Cooper v Hobart, 2001 SCC 79' },
  { id: 'tor-2', subject: 'Torts', answer: 'A',
    q: 'The default test for factual causation in negligence is:',
    options: { A: '"But for" the defendant’s negligence, would the injury have occurred?', B: 'Whether the defendant materially increased the risk, in every case', C: 'Whether the negligence was the sole cause', D: 'Proximate cause as defined by the jury' },
    why: 'Clements confirms but-for as the default; material-contribution-to-risk is exceptional (multiple tortfeasors, impossibility of proof).',
    cite: 'Clements v Clements, 2012 SCC 32' },
  { id: 'tor-3', subject: 'Torts', answer: 'D',
    q: 'The thin skull and crumbling skull principles mean a defendant:',
    options: { A: 'Pays nothing where the plaintiff was unusually vulnerable', B: 'Pays for the plaintiff’s whole condition including its inevitable pre-existing course', C: 'Pays only for injuries a person of ordinary fortitude would have suffered', D: 'Takes the victim as found and pays for the injury caused, but not for the debilitating effects of a pre-existing condition the plaintiff would have suffered anyway' },
    why: 'Athey v Leonati: full liability for the harm caused to this plaintiff, less the losses that were coming regardless.',
    cite: 'Athey v Leonati, [1996] 3 SCR 458' },
  { id: 'tor-4', subject: 'Torts', answer: 'B',
    q: 'The standard of care expected of a professional in negligence is that of:',
    options: { A: 'The most careful practitioner in the field', B: 'A reasonably competent member of that profession in like circumstances', C: 'The general public’s reasonable person, regardless of specialty', D: 'Whatever the profession’s association bylaws prescribe' },
    why: 'Professionals are held to the standard of the reasonable practitioner of that discipline; conformity with standard practice is strong but not conclusive evidence.',
    cite: 'ter Neuzen v Korn, [1995] 3 SCR 674' },
  { id: 'tor-5', subject: 'Torts', answer: 'A',
    q: 'Where a plaintiff’s own negligence contributed to the loss, the effect in Ontario is:',
    options: { A: 'Damages are apportioned and reduced in proportion to the plaintiff’s fault; the claim is not barred', B: 'The claim is barred entirely', C: 'The defendant pays in full but may seek indemnity later', D: 'The plaintiff recovers only special damages' },
    why: 'The Negligence Act replaced the common-law bar with apportionment by degree of fault.',
    cite: 'Negligence Act, RSO 1990, c N.1, s 3' },
  { id: 'tor-6', subject: 'Torts', answer: 'C',
    q: 'Under Ontario’s Occupiers’ Liability Act, an occupier owes persons entering the premises:',
    options: { A: 'No duty to trespassers of any kind', B: 'A duty only to invitees, not licensees', C: 'A duty to take such care as is reasonable in the circumstances to see that persons and their property are reasonably safe while on the premises', D: 'An absolute duty to prevent all injury' },
    why: 'Section 3 replaces the old invitee/licensee categories with a single reasonableness duty (modified for willing assumption of risk and criminal entrants).',
    cite: 'Occupiers’ Liability Act, RSO 1990, c O.2, s 3' },

  // ---- Remedies, damages & interlocutory relief ------------------------------
  { id: 'rem-1', subject: 'Remedies', answer: 'B',
    q: 'The duty to mitigate means an innocent party:',
    options: { A: 'Must accept any settlement offered', B: 'Cannot recover losses that could have been avoided by taking reasonable steps after the breach or tort', C: 'Forfeits the claim if any avoidable loss is claimed', D: 'Must mitigate only if the contract says so' },
    why: 'Avoidable losses are not recoverable; the burden of proving failure to mitigate lies on the defendant.',
    cite: 'Asamera Oil, [1979] 1 SCR 633; Southcott, 2012 SCC 51' },
  { id: 'rem-2', subject: 'Remedies', answer: 'D',
    q: 'Specific performance of an agreement to purchase land will be ordered:',
    options: { A: 'As of right, because land is always unique', B: 'Never; damages are always adequate for land', C: 'Only where the vendor consents', D: 'Where the plaintiff shows the property is unique such that damages are inadequate — land is no longer presumed unique' },
    why: 'Semelhago v Paramadevan removed the presumption; the purchaser must show substitutes are inadequate.',
    cite: 'Semelhago v Paramadevan, [1996] 2 SCR 415' },
  { id: 'rem-3', subject: 'Remedies', answer: 'A',
    q: 'Punitive damages for breach of contract require:',
    options: { A: 'An independent actionable wrong in addition to the breach, and conduct that is a marked departure from ordinary standards of decency', B: 'Only that the breach was deliberate', C: 'A prior criminal conviction', D: 'A contractual clause permitting them' },
    why: 'Whiten v Pilot Insurance: an independent actionable wrong (there, breach of the duty of good faith) plus reprehensible conduct; rationally proportionate awards.',
    cite: 'Whiten v Pilot Insurance, 2002 SCC 18' },
  { id: 'rem-4', subject: 'Remedies', answer: 'C',
    q: 'Non-pecuniary damages for personal injury in Canada are:',
    options: { A: 'Unlimited, as the jury decides', B: 'Fixed by statute at $100,000', C: 'Subject to the judicially imposed cap from the 1978 SCC trilogy, adjusted for inflation', D: 'Recoverable only in catastrophic cases' },
    why: 'Andrews/Thornton/Arnold set a cap (about $100,000 in 1978 dollars) on non-pecuniary awards, indexed since.',
    cite: 'Andrews v Grand & Toy, [1978] 2 SCR 229' },
  { id: 'rem-5', subject: 'Remedies', answer: 'B',
    q: 'Costs in Ontario civil litigation are:',
    options: { A: 'Never awarded between parties', B: 'In the court’s discretion, ordinarily following the event on a partial indemnity basis, with elevated scales for defined conduct and offers', C: 'Always full indemnity for the winner', D: 'Fixed as a percentage of the judgment' },
    why: 'Courts of Justice Act s 131 makes costs discretionary; convention awards partial indemnity to the successful party, elevated by r 49 or misconduct.',
    cite: 'Courts of Justice Act, s 131; r 57.01' },
  { id: 'rem-6', subject: 'Remedies', answer: 'A',
    q: 'An interlocutory injunction requires the moving party to establish:',
    options: { A: 'A serious question to be tried, irreparable harm if refused, and that the balance of convenience favours granting it', B: 'A strong prima facie case, in every case', C: 'Irreparable harm alone', D: 'That damages have already been quantified' },
    why: 'RJR-MacDonald’s three-part test (a strong prima facie case is demanded only for mandatory interlocutory injunctions, per CBC 2018).',
    cite: 'RJR-MacDonald v Canada, [1994] 1 SCR 311' },
];

// Strict grading. The model is told to answer with a single letter; anything
// that cannot be confidently read as one letter is WRONG, not retried — an
// assistant that cannot follow "answer A-D" is not one to take drafting
// suggestions from.
function parseLetter(text) {
  const t = String(text == null ? '' : text).trim();
  let m = /^\(?([A-D])\)?[.)]?$/i.exec(t);
  if (m) return m[1].toUpperCase();
  m = /^\(?([A-D])\)?[.):\s]/i.exec(t);
  if (m) return m[1].toUpperCase();
  m = /answer\s*(?:is)?\s*:?\s*\(?([A-D])\)?\b/i.exec(t);
  if (m) return m[1].toUpperCase();
  return null;
}

function prompt(q) {
  return `${q.q}\n\nA. ${q.options.A}\nB. ${q.options.B}\nC. ${q.options.C}\nD. ${q.options.D}\n\n` +
    `Reply with the single capital letter of the best answer and nothing else. [${q.id}]`;
}

// Run the bench through the given transport. `chatFn(cfg, messages, opts)` is
// kernel/ai.js chat (or a test stub with the same shape); cfg is the gateway
// setting. Sequential on purpose: a local model answering 48 questions should
// not be hit 48-wide, and order makes progress reporting simple.
async function run(cfg, chatFn, { questions = BANK, onProgress } = {}) {
  if (!cfg || !cfg.endpoint || !cfg.model) return { ok: false, message: 'No model endpoint configured.' };
  const answers = [];
  for (const q of questions) {
    const out = await chatFn(cfg, [{ role: 'user', content: prompt(q) }], { maxTokens: 8, temperature: 0 });
    const got = out && out.ok ? parseLetter(out.text) : null;
    answers.push({ id: q.id, subject: q.subject, expected: q.answer, got, correct: got === q.answer });
    if (onProgress) onProgress(answers.length, questions.length);
  }
  const bySubject = {};
  for (const a of answers) {
    const s = bySubject[a.subject] || (bySubject[a.subject] = { total: 0, correct: 0 });
    s.total++; if (a.correct) s.correct++;
  }
  const correct = answers.filter((a) => a.correct).length;
  const pct = answers.length ? correct / answers.length : 0;
  return {
    ok: true,
    total: answers.length,
    correct,
    pct: Math.round(pct * 1000) / 10,
    passLine: Math.round(PASS_LINE * 100),
    passed: pct >= PASS_LINE,
    bySubject,
    wrong: answers.filter((a) => !a.correct).map((a) => ({ id: a.id, expected: a.expected, got: a.got })),
  };
}

module.exports = { BANK, PASS_LINE, run, parseLetter, prompt };
