// The statute book: the Constitution, founding Acts, Regulations and Executive Orders.
// Founding instruments are kept in sync with this file on every start (laws made by
// citizen bills are never touched). Every rule here matches how the platform behaves.
import { NATION, SECURITY } from './config.js';

const N = NATION;
const C = N.currency;
const V = C.values;
const S = C.symbol;
const PE = SECURITY.passportElevationSeconds / 60;
const EP = SECURITY.epochSeconds / 60;

export const AREAS = [
  'Constitution & Government', 'Citizenship & Identity', 'Treasury & Currency', 'Commerce & Consumers',
  'Criminal Law', 'Courts & Justice', 'Rights & Privacy', 'Digital Security', 'Democracy & Elections',
  'Public Service & Ethics', 'Culture, Education & Community', 'Foreign Affairs',
];

const body = (sections) => sections.map(([h, t], i) => `## ${i + 1}. ${h}\n${t.trim()}`).join('\n\n');
let actNo = 0; let regNo = 0; let eoNo = 0;
const act = (title, area, dept, summary, sections) => ({ code: `Act 2026-${String(++actNo).padStart(2, '0')}`, kind: 'act', title, area, dept, summary, body: body(sections) });
const reg = (title, area, dept, summary, sections) => ({ code: `Reg. 2026-${String(++regNo).padStart(2, '0')}`, kind: 'regulation', title, area, dept, summary, body: body(sections) });
const order = (title, area, dept, summary, sections) => ({ code: `EO 2026-${String(++eoNo).padStart(2, '0')}`, kind: 'order', title, area, dept, summary, body: body(sections) });

const CONSTITUTION = `# Constitution of ${N.name}

*We, the citizens of ${N.short}, each a real and single person, establish this Constitution so that a community built online may govern itself with the same seriousness as any nation on Earth.*

## Article I — The Nation
1. ${N.name} is a sovereign online community of its citizens.
2. Its motto is *${N.motto}*. Its currency is the ${C.name} (${S}).
3. Sovereignty rests with the citizens, exercised directly through the National Assembly.
4. This Constitution is the supreme law. Any Act, Regulation or Order inconsistent with it is void to the extent of the inconsistency.

## Article II — Citizenship
1. Citizenship is open to any natural person who proves their identity to the Department of Citizenship & Identity. A person under 13 also needs the consent of a parent or guardian under the Minors Protection Act.
2. **One person, one citizenship.** No person may hold more than one account. An identity document may back only one citizen, forever.
3. Every citizen is issued a digital passport and a personal **.access key**. The key is the citizen's alone; the State never holds it.
4. Citizenship may be suspended or revoked only under law, and every suspension is published in the Official Gazette.
5. Citizenship of ${N.short} does not affect any person's nationality, rights or duties in any country on Earth.

## Article III — Rights of Citizens
1. Freedom of expression in the Public Forum, subject only to the Public Forum Conduct Act.
2. The right to propose, sponsor and vote on legislation.
3. The right to own, trade and keep ${C.plural}, and to sell goods and services in the Marketplace.
4. The right to access public records, and to have personal identity documents kept private.
5. The right to due process and to appeal any government decision to the Supreme Tribunal.
6. Equality before the law, without distinction of origin, belief, sex, disability or any other status.

## Article IV — The National Assembly
1. Every citizen is a member of the National Assembly.
2. A bill tabled by a citizen opens for a national vote once it has ${SECURITY.billSignatureThreshold} sponsor signatures.
3. A national vote lasts ${SECURITY.billVotingDays} days. A bill passes if Yes votes exceed No votes and turnout reaches one tenth of citizens.
4. Each vote is cryptographically signed with the voter's .access key and recorded permanently.

## Article V — The Head of State
1. The Head of State gives or withholds assent to bills that pass a national vote. A withheld assent must be published with reasons.
2. The Head of State appoints officials to departments, and may dismiss them.
3. The Head of State may issue Executive Orders to run the government, but an Order may not create an offence, levy a charge, or override an Act.
4. When the office of Head of State is vacant, the National Council chooses the next Head of State from the citizens who apply, by a majority of its members.

## Article VI — The Supreme Tribunal
1. The Tribunal interprets this Constitution and decides disputes.
2. Its rulings are published in the Official Gazette and bind every organ of the State.

## Article VII — The Treasury
1. Every new citizen receives a grant of ${N.citizenshipGrant} ${C.plural}, minted on the issue of their first passport.
2. Each ${C.name}'s face value is fixed by its rarity under the ${C.name} Currency Act.
3. No ${C.name} may be created except by grant or as Mint change under law. All movements are recorded on a public, tamper-evident ledger.

## Article VIII — Amendment
This Constitution may be amended by a bill that passes the national vote with two thirds of votes cast in favour and turnout of at least one quarter of citizens.`;

export function buildLaws() {
  actNo = 0; regNo = 0; eoNo = 0;
  const GOV = 'Constitution & Government'; const CIT = 'Citizenship & Identity'; const TRE = 'Treasury & Currency';
  const COM = 'Commerce & Consumers'; const CRIM = 'Criminal Law'; const CRT = 'Courts & Justice'; const RTS = 'Rights & Privacy';
  const SEC = 'Digital Security'; const DEM = 'Democracy & Elections'; const ETH = 'Public Service & Ethics';
  const CUL = 'Culture, Education & Community'; const FOR = 'Foreign Affairs';

  return [
    { code: 'Constitution', kind: 'constitution', title: `Constitution of ${N.name}`, area: GOV, dept: 'assembly', summary: 'The supreme law: citizenship, rights, the Assembly, the Head of State, the Tribunal and the Treasury.', body: CONSTITUTION },

    // ---------------------------------------------------------------- Citizenship & Identity
    act('Citizenship and Identity Act', CIT, 'citizenship', 'How a person proves who they are, how duplicate accounts are prevented, and how passports and .access keys are issued and revoked.', [
      ['Application', 'An applicant must (a) verify an email address, (b) submit a photograph of a government-issued identity document, and (c) take a live selfie while performing a randomly generated liveness prompt that expires after 30 minutes.'],
      ['Uniqueness', `1. The Department stores a keyed one-way fingerprint (HMAC) of each identity document number, never the number itself.\n2. A document fingerprint that already backs a pending, approved or banned application cannot be used again.\n3. Matching names and dates of birth, shared networks and similar selfies are flagged to the reviewer.\n4. Knowingly creating a second account is an offence under the Criminal Code.`],
      ['Review', 'A registrar of the Department, or the Head of State, decides each application after a passport check of their own. A registrar may not decide their own application. A rejected applicant may reapply; a banned document may never be used again.'],
      ['Passport and key', 'On approval the applicant\'s browser creates a personal key pair. The private key is encrypted with the citizen\'s password into a **.access file** that only the citizen holds. The Department signs a passport that carries the public key fingerprint.'],
      ['Security levels', `1. *Standard:* account name and password.\n2. *Elevated:* additionally upload the passport image, which is checked for the Department's signature. Elevation lasts ${PE} minutes.\n3. *Ultra-secure:* scan the .access file. It is decrypted in the citizen's own browser, signs a challenge bound to the rotating server key and to the exact action, and is then confirmed with account name and password.`],
      ['Lost keys', 'A citizen who loses their .access file may request a reissue. When it is approved, a new key is generated and every earlier passport image stops working.'],
    ]),
    act('Passport Act', CIT, 'citizenship', 'The form, validity, verification and misuse of the national digital passport.', [
      ['Form', `The passport is a digital data page showing the holder's photograph, name, date of birth, passport number, dates of issue and expiry, the holder's key fingerprint, a machine-readable zone and a verification code. It carries an embedded token signed with the government's Ed25519 key.`],
      ['Validity', 'A passport is valid for ten years from issue, and only in its current version. Reissue supersedes every earlier image.'],
      ['Verification', `Any person may verify a passport number, or upload a passport image, on the public verification page. Verification reveals only the holder's account name, display name, issue date, version and key fingerprint.`],
      ['Formats', 'The SVG data page and the PNG export are both official. Any other rendering, screenshot or print is a copy and has no legal effect.'],
      ['Misuse', 'Presenting another person\'s passport, or an altered passport, is an offence under the Criminal Code.'],
    ]),
    act('Digital Keys and Signatures Act', CIT, 'digital', 'Gives .access-key signatures the force of a handwritten signature and sets the duties of key holders.', [
      ['Legal effect', 'An action authorised with a citizen\'s .access key, their account name and their password is legally the act of that citizen, with the same force as a handwritten signature.'],
      ['Holder duties', 'A citizen must keep their .access file and password confidential, must not share them with any person (including officials), and must report a lost or exposed key without delay.'],
      ['State duties', 'The State shall never request, receive or store a citizen\'s private key. Any official who asks a citizen for their .access file or password commits misconduct.'],
      ['Presumption', 'An action recorded with a valid signature is presumed authorised by the citizen unless they show it was made after they reported the key lost.'],
    ]),
    act('Minors Protection Act', CIT, 'citizenship', 'Additional protections for citizens under 18, and parental consent for children under 13.', [
      ['Scope', 'This Act protects every citizen under 18 years of age ("young citizen").'],
      ['Children under 13', `1. An applicant under 13 may become a citizen only with the consent of a parent or guardian.
2. The applicant names the parent or guardian and their own email address. The Department emails them a link explaining what citizenship involves, and they give or refuse consent there.
3. No registrar may approve the application before consent is given. If consent is refused, the application is closed and the identity document and selfie are deleted.`],
      ['Guardian rights', `A parent or guardian of a citizen under 13 may at any time ask the Department to show them the personal information held about the child, to correct it, or to withdraw consent. On withdrawal the account is closed and the identity document and selfie are deleted.`],
      ['Data minimisation', `From a child under 13 the State collects only what is needed to verify a real, unique person, and never publishes it.`],
      ['Contact', 'No person may solicit personal information, images or off-platform contact from a young citizen. Doing so is an aggravating factor under the Criminal Code.'],
      ['Commerce', 'Listings of age-restricted goods may not be sold to young citizens. Sellers of such goods must refuse or refund orders from them.'],
      ['Records', 'A young citizen\'s date of birth is never published, consistent with the Data Protection Act.'],
    ]),
    act('Renunciation and Loss of Citizenship Act', CIT, 'citizenship', 'How citizenship may be given up, suspended or revoked, and what happens to property.', [
      ['Renunciation', 'A citizen may renounce citizenship by written request to the Department. Renunciation is published in the Gazette.'],
      ['Suspension', 'The Head of State may suspend a citizen who is the subject of a serious charge under the Criminal Code, pending a ruling of the Supreme Tribunal. A suspension signed with the Head of State\'s .access key is published in the Gazette.'],
      ['Revocation', 'Only the Supreme Tribunal may revoke citizenship, and only for creating duplicate accounts, identity fraud, or repeated serious offences.'],
      [`${C.plural} and orders`, `A suspended citizen keeps their ${C.plural}. Open marketplace orders are refunded or completed under the Marketplace Commerce Act.`],
    ]),

    // ---------------------------------------------------------------- Treasury & Currency
    act(`${C.name} Currency Act`, TRE, 'treasury', `Establishes the ${C.name} as the sole currency: collectible tokens with fixed face values by rarity, and a public ledger.`, [
      [`Nature of the ${C.name}`, `Each ${C.name} is a unique, serially numbered token. Its rarity is fixed forever by its serial number.`],
      ['Face values', `The face value of a ${C.name} is fixed by its rarity:\n- **Common** — ${V.common} ${S}\n- **Uncommon** — ${V.uncommon} ${S} (about 1 in 6 minted)\n- **Rare** — ${V.rare} ${S} (about 1 in 21)\n- **Epic** — ${V.epic} ${S} (1 in 100)\n- **Legendary** — ${V.legendary} ${S} (1 in 500)\nBalances, prices and transfers are measured in ${S} of face value.`],
      ['Issuance', `${N.citizenshipGrant} ${C.plural} are minted to each citizen when their first passport is issued. Because rarities are random, grants differ in value; on average a grant is worth about 1,790 ${S}. The only other issuance is Mint change under the Mint Exchange Act.`],
      ['Payments', `A payment must equal its amount exactly. A wallet spends its lowest-value ${C.plural} first so collectibles are kept; a citizen may instead choose exactly which ${C.plural} to send.`],
      ['Transfers', `A transfer must be signed with the sender's .access key and their Aurum wallet. It is final once recorded on the blockchain.`],
      ['Citizens only', `${C.plural} can be held only by citizens, the Treasury reserve and marketplace escrow. The Sigil contract refuses any transfer to anyone else, so ${C.plural} cannot be listed on crypto exchanges or marketplaces.`],
      ['No cash value', `${C.plural} have no value in any real-world currency. The State never buys, sells or redeems them for money, and face values are measured only in ${S}.`],
      ['Amendment of values', 'Face values may be changed only by an Act passed by national vote.'],
    ]),
    act('Mint Exchange Act', TRE, 'treasury', `Lets any citizen break a ${C.name} into smaller change of equal value at the Mint.`, [
      ['Right to change', `A citizen may deposit any ${C.name} other than a common at the Mint and receive ${C.plural} of equal total face value in return.`],
      ['Automatic change', `When a payment cannot be made exactly from a citizen's ${C.plural}, the wallet breaks the smallest sufficient ${C.name} at the Mint automatically, then pays exactly.`],
      ['Source of change', `Change is paid first from lower-value ${C.plural} held in the Treasury reserve, then by minting new common ${C.plural} ("Mint change").`],
      ['Neutrality', 'Every exchange is value-neutral for the citizen and for circulation. Both legs are recorded on the public ledger.'],
    ]),
    act('Treasury Reserve Act', TRE, 'treasury', `Governs ${C.plural} held by the Treasury, which are outside circulation.`, [
      ['Reserve', `${C.plural} deposited at the Mint are held in the Treasury reserve. Reserve ${C.plural} are not counted as money in circulation.`],
      ['Use', 'Reserve tokens may be used only to pay Mint change. Any other use, including sale of reserve collectibles, requires an Act.'],
      ['Reporting', 'The Treasury publishes circulating value, reserve value, escrow value and the distribution of rarities in real time.'],
    ]),
    act('Public Ledger Act', TRE, 'treasury', 'Requires every currency movement to be recorded on a hash-chained, signed ledger that anyone can audit.', [
      ['Entries', 'Every mint, transfer, escrow movement and Mint exchange is recorded with its time, parties, value, the serials moved and a memo.'],
      ['Integrity', 'Each entry contains the hash of the entry before it and is signed by the Treasury. Citizen-initiated entries also carry the citizen\'s signature and the exact parameters they signed.'],
      ['Audit', 'Any person may re-verify the entire chain at any time from Public Records. A failed verification must be investigated by the Department of Digital Security and reported in the Gazette.'],
      ['Permanence', 'No entry may be altered or deleted. Errors are corrected only by new, explained entries.'],
    ]),
    act('Taxation Principles Act', TRE, 'treasury', 'No tax may be levied except by an Act passed by national vote.', [
      ['No taxation without a vote', `No tax, fee, levy or charge of any kind may be imposed on citizens or ${C.name} transfers except by an Act passed by national vote.`],
      ['Current position', 'At the founding, no taxes or fees are levied. Using government services is free.'],
      ['Transparency', 'Any future tax must state its rate, its purpose and the department accountable for spending it.'],
    ]),
    act('Aurum Wallet and Blockchain Act', TRE, 'treasury', `Puts the ${C.name} on a blockchain and gives every citizen the Aurum wallet.`, [
      ['The Sigil contract', `Ownership of every ${C.name} is recorded by the Sigil contract on an Ethereum-compatible blockchain. The contract fixes face values, mints exactly one citizenship grant per citizen, and allows no other issuance except Mint change.`],
      ['Aurum', `Every citizen has an Aurum wallet, built into the national portal. Its key is derived from the citizen's .access key, so the .access file is the wallet. No other wallet software is needed.`],
      ['Gas', "The Treasury relays citizens' signed payments to the blockchain and pays all network fees. Citizens never need to hold any other cryptocurrency."],
      ['No seizure', `The Treasury cannot move a citizen's ${C.plural} without that citizen's Aurum signature; the contract enforces this. A citizen may also submit their own signed payment directly to the contract.`],
      ['Registrar', "The Treasury registers citizens on the contract, changes a citizen's Aurum key when their .access key is reissued, and records suspensions. Each of these is public on the blockchain."],
      ['Audit', 'Anyone may compare the blockchain with the national ledger at any time from Public Records, or query the contract directly.'],
    ]),
    act('Collectibles Act', TRE, 'treasury', `Protects the collectible character of ${C.plural} and regulates their trade.`, [
      ['Collector trading', `Citizens may sell or buy specific ${C.plural} for more or less than face value by private agreement or in the Marketplace "collectibles" category.`],
      ['Provenance', `The ledger is the sole record of a ${C.name}'s provenance. No other certificate has legal effect.`],
      ['Misrepresentation', 'Describing a token falsely, including its serial, rarity or history, is market fraud under the Criminal Code.'],
    ]),
    act('Anti-Fraud and Financial Integrity Act', TRE, 'treasury', 'Prevents fraud, laundering and abuse of the currency.', [
      ['Prohibited schemes', `Pyramid schemes, Ponzi schemes, wash trading of collectibles and coordinated manipulation of ${C.name} prices are prohibited.`],
      ['Suspicious activity', 'The Treasury may flag unusual patterns, such as many new accounts sending to one recipient, and refer them to the Department of Justice.'],
      ['No freezing without a court', `The State may not freeze or seize ${C.plural} except by order of the Supreme Tribunal.`],
    ]),

    // ---------------------------------------------------------------- Commerce & Consumers
    act('Marketplace Commerce Act', COM, 'commerce', 'Governs listings, payments, escrow and disputes in the national marketplace.', [
      ['Listings', `Any citizen who has passed a passport check may list goods or services priced in ${S}. A citizen may have up to 50 active listings.`],
      ['Purchase', 'A purchase must be signed with the buyer\'s .access key and is bound to the price shown. If the seller changes the price, the purchase fails and the buyer must review the new price.'],
      ['Escrow', `Payment is held in escrow when an order is placed. Commons and uncommons are used first so the buyer's collectibles are kept. Escrow is released to the seller when the buyer confirms receipt, or refunded if the seller cancels.`],
      ['Disputes', 'A buyer may open a dispute before confirming receipt. The Department of Commerce rules on disputes and its ruling moves the escrowed tokens. Either party may appeal to the Supreme Tribunal.'],
      ['Reviews', 'Only buyers with completed orders may review a seller, once per order.'],
    ]),
    act('Consumer Protection Act', COM, 'commerce', 'Basic rights for every buyer in the national marketplace.', [
      ['Accurate description', 'Goods and services must match their listing. Photographs must show the actual item or clearly state that they are illustrative.'],
      ['Delivery', 'A seller must deliver, or refund, within 14 days of the order unless the listing states a longer period.'],
      ['Refunds', 'A buyer who receives goods materially different from the listing is entitled to a full refund through escrow.'],
      ['No waiver', 'These rights cannot be waived by any term in a listing.'],
    ]),
    act('Prohibited Goods Act', COM, 'commerce', 'Lists goods and services that may not be traded.', [
      ['Prohibited', 'Weapons and ammunition; illegal drugs; stolen property; counterfeit goods; personal data of other people; account credentials; .access files; passports or passport images; services to create accounts for others; anything illegal where the buyer or seller lives.'],
      ['Real money', `${C.plural}, accounts and collectibles may not be sold or bought for real-world money, inside or outside the nation.`],
      ['Age-restricted', 'Goods restricted by age where the buyer lives may be listed only with a clear warning and may not be sold to young citizens.'],
      ['Enforcement', 'Officials may remove prohibited listings. Listing prohibited goods is an offence under the Criminal Code.'],
    ]),
    act('Digital Goods and Services Act', COM, 'commerce', 'Special rules for digital deliveries and services.', [
      ['Delivery', 'Digital goods are delivered when the seller gives access, for example a link or code in the delivery note.'],
      ['Licences', 'A listing for digital goods must state what the buyer may do with them (personal use, commercial use, resale).'],
      ['Services', 'A listing for a service must state what will be done and by when. Payment stays in escrow until the buyer confirms the service was performed.'],
    ]),
    act('Contracts Act', COM, 'commerce', 'When agreements between citizens are binding.', [
      ['Formation', 'An agreement is binding when both parties accept clear terms, including through a marketplace order or a signed message.'],
      ['Capacity', `Agreements by young citizens worth more than 100 ${S} may be cancelled by the young citizen within 14 days.`],
      ['Remedies', `The Supreme Tribunal may order performance, refund, or payment of ${C.plural} as compensation.`],
    ]),
    act('Intellectual Property Act', COM, 'commerce', 'Recognises creators\' rights over works and brands within the nation.', [
      ['Copyright', 'The creator of an original work published in the nation owns it. Others may not sell copies without permission.'],
      ['Trade names', 'A shop name or brand used by a seller in good faith may not be imitated to mislead buyers.'],
      ['Fair use', 'Quotation, criticism, news reporting and parody are permitted.'],
      ['Takedown', 'A rights-holder may report infringing listings or posts. Officials decide within 7 days.'],
    ]),
    act('Advertising Standards Act', COM, 'commerce', 'Honesty in promotion.', [
      ['Honesty', 'Advertising in the Marketplace or Forum must not be false or misleading.'],
      ['Disclosure', 'A citizen promoting something they are paid to promote must say so.'],
      ['Spam', 'Repetitive unsolicited promotion is spam under the Public Forum Conduct Act.'],
    ]),

    // ---------------------------------------------------------------- Criminal Law
    act('Criminal Code', CRIM, 'justice', 'Defines offences against the nation, its citizens and its institutions.', [
      ['Principles', 'No person may be sanctioned for conduct that was not an offence when it occurred. Sanctions are limited to those in the Sanctions Act; the nation imposes no physical penalties.'],
      ['Multiple accounts', 'Creating or controlling more than one account, or helping another to do so.'],
      ['Identity fraud', 'Applying for citizenship with another person\'s identity document or likeness, or with a forged document.'],
      ['Impersonation', 'Pretending to be another citizen, an official, or the government.'],
      ['Passport fraud', 'Altering, forging, selling or presenting another person\'s passport.'],
      ['Key theft', `Obtaining another citizen's .access file or password, or using them, by any means.`],
      ['Unauthorised access', 'Accessing, or attempting to access, systems or accounts without permission, other than research protected by the Responsible Disclosure Act.'],
      ['Market fraud', 'Taking payment without intending to deliver; misdescribing goods or collectibles; fake reviews.'],
      ['Vote fraud', 'Voting more than once, buying or selling votes, or coercing a voter.'],
      ['Bribery', 'Offering or accepting anything of value to influence an official decision.'],
      ['Harassment and threats', 'Repeated unwanted contact intended to distress; threats of harm online or offline.'],
      ['Doxxing', 'Publishing another person\'s private information, including real-world identity or address, without consent.'],
      ['Disruption', 'Flooding, spamming or deliberately overloading national services.'],
    ]),
    act('Sanctions Act', CRIM, 'justice', 'The penalties the Supreme Tribunal may impose.', [
      ['Available sanctions', `1. Formal warning, published or private.\n2. Restitution: return of ${C.plural} or goods to a victim.\n3. Fine in ${S}, paid to the Treasury reserve, up to 500 ${S}.\n4. Restriction from the Marketplace or Forum for a fixed period.\n5. Suspension of citizenship for a fixed period.\n6. Revocation of citizenship.`],
      ['Proportionality', 'A sanction must be proportionate to the offence, the harm caused, and the offender\'s history.'],
      ['Real-world law', 'Where conduct may also be a crime in a country on Earth, victims may report it to the authorities there. The nation cooperates with lawful requests under the Foreign Relations Act.'],
    ]),
    act('Due Process Act', CRIM, 'justice', 'Rights of any citizen accused of an offence.', [
      ['Notice', 'An accused citizen must be told the charge and the evidence in writing.'],
      ['Hearing', 'They may answer in writing and call witnesses before any sanction other than an urgent temporary suspension.'],
      ['Presumption of innocence', 'No one is guilty until a ruling of the Supreme Tribunal.'],
      ['Appeal', 'Every sanction may be appealed once to a full panel of the Tribunal.'],
    ]),
    act('Evidence Act', CRIM, 'judiciary', 'What counts as proof.', [
      ['Ledger', 'Entries on the public ledger, and signatures that verify against a citizen\'s public key, are conclusive proof of what they record.'],
      ['Forum and messages', 'Posts and order messages are admissible as they appear in national records.'],
      ['Screenshots', 'Screenshots carry weight only if consistent with national records.'],
      ['Identity documents', 'Identity documents may be shown to the Tribunal only, never published.'],
    ]),
    act('Victims\' Rights Act', CRIM, 'justice', 'Protections for citizens harmed by offences.', [
      ['Information', 'Victims are told the progress and outcome of their case.'],
      ['Privacy', 'A victim\'s identity is withheld from published rulings on request.'],
      ['Restitution first', 'Restitution to victims is ordered before any fine.'],
    ]),

    // ---------------------------------------------------------------- Courts & Justice
    act('Supreme Tribunal Act', CRT, 'judiciary', 'Composition, jurisdiction and procedure of the Supreme Tribunal.', [
      ['Composition', 'The Tribunal consists of the Chief Justice and justices appointed by the Head of State. A case is heard by one justice, or by three on appeal.'],
      ['Jurisdiction', 'Constitutional questions; offences under the Criminal Code; appeals of citizenship, moderation and marketplace decisions; contract disputes.'],
      ['Independence', 'A justice may not be dismissed for the content of a ruling and must step aside from any case in which they have an interest.'],
      ['Publication', 'Rulings are published in the Gazette with reasons.'],
    ]),
    act('Dispute Resolution Act', CRT, 'commerce', 'Fast, fair handling of disputes between citizens.', [
      ['First step', 'Parties should first try to resolve a dispute through order messages.'],
      ['Commerce rulings', 'Marketplace disputes are decided by an official of the Department of Commerce within 7 days, with reasons visible to both parties.'],
      ['Appeal', 'A ruling may be appealed to the Supreme Tribunal within 14 days.'],
    ]),
    act('Citizen Panels Act', CRT, 'judiciary', 'Lets citizens sit on panels for serious cases.', [
      ['Panels', 'For revocation of citizenship, the Tribunal sits with a panel of five citizens chosen at random from volunteers.'],
      ['Decision', 'Revocation requires the agreement of the justice and at least four panel members.'],
      ['Conflicts', 'A panel member who knows a party must step aside.'],
    ]),
    act('Appeals and Review Act', CRT, 'judiciary', 'How to challenge any government decision.', [
      ['Right of review', 'Any citizen affected by a decision of an official may ask the Supreme Tribunal to review it.'],
      ['Grounds', 'Unlawfulness, unfairness, irrationality, or failure to give reasons.'],
      ['Remedies', 'The Tribunal may quash, replace, or send back the decision.'],
    ]),

    // ---------------------------------------------------------------- Rights & Privacy
    act('Bill of Rights Act', RTS, 'judiciary', 'Sets out in detail the rights guaranteed by the Constitution.', [
      ['Expression', 'Every citizen may express opinions, including criticism of the government and its officials.'],
      ['Association', 'Citizens may form groups, clubs and parties, and may use the Forum to organise.'],
      ['Property', `No citizen may be deprived of ${C.plural} or goods except by law and a ruling of the Supreme Tribunal.`],
      ['Equality', 'No law or official may discriminate against any person on grounds of origin, ethnicity, religion or belief, sex, gender identity, sexual orientation, disability or age (except as protects young citizens).'],
      ['Conscience', 'No citizen is obliged to vote, post or trade.'],
    ]),
    act('Data Protection Act', RTS, 'records', 'How the State handles personal data.', [
      ['Minimum data', 'The State collects only the data it needs: account details, the identity application, and records of public actions.'],
      ['Never published', 'Identity documents, selfies, legal names, dates of birth, email addresses and network addresses are never published.'],
      ['Fingerprints', 'Identity document numbers are kept only as keyed one-way fingerprints and the last four characters.'],
      ['Access logging', 'Every time an official views an identity document, the access is recorded in the audit log.'],
      ['Your rights', 'A citizen may ask what personal data the State holds about them and have errors corrected.'],
    ]),
    act('Public Records Act', RTS, 'records', 'Makes government records public by default and gives every citizen the right to request records.', [
      ['Open by default', 'The Citizen Registry (account name, display name, passport number, key fingerprint), the Official Gazette, the Ledger and all legislation are public.'],
      ['Private by law', 'Identity documents, selfies, dates of birth, email addresses and legal names are never published.'],
      ['Requests', 'Any citizen who has passed a passport check may request a record. The responsible department must publish its response, granting or refusing it with reasons, within 30 days.'],
    ]),
    act('Public Forum Conduct Act', RTS, 'justice', 'Protects free expression in the Public Forum while prohibiting harassment, spam and fraud.', [
      ['Freedom of expression', 'Citizens may discuss any subject, including criticism of the government.'],
      ['Prohibited conduct', 'Harassment, threats, hate directed at people for who they are, doxxing, spam, impersonation and fraud.'],
      ['Reports', 'Any citizen may report a post, thread, listing or user. Reports go to officials.'],
      ['Moderation', 'Officials may remove content that breaks this Act, lock or pin threads, and must log every action. Removals can be appealed to the Supreme Tribunal.'],
      ['Announcements', 'Only officials may start threads in Official Announcements; citizens may reply.'],
    ]),
    act('Accessibility Act', RTS, 'digital', 'National services must be usable by everyone.', [
      ['Standard', 'National services shall follow recognised web accessibility guidelines, including keyboard use, screen readers and readable contrast.'],
      ['Alternatives', 'A citizen without a camera may upload a selfie instead of a live capture; the application is reviewed with extra care but not refused for that reason alone.'],
      ['Complaints', 'Accessibility barriers may be reported to the Department of Digital Security.'],
    ]),

    // ---------------------------------------------------------------- Digital Security
    act('Cybersecurity Act', SEC, 'digital', 'Duties of the State to keep national systems secure.', [
      ['Rotating key', `The server key used to seal challenges rotates every ${EP} minutes. A challenge is valid only in the epoch it was issued and the next one, and only once.`],
      ['Signing keys', 'The passport and ledger signing key is kept secret and backed up. Its public half and fingerprint are published.'],
      ['Passwords', 'Passwords are stored only as salted scrypt hashes. Sign-in and sensitive actions are rate-limited.'],
      ['Breach notification', 'Any breach affecting citizens must be announced in the Gazette within 72 hours of discovery.'],
    ]),
    act('Responsible Disclosure Act', SEC, 'digital', 'Protects citizens who find and report security flaws in good faith.', [
      ['Safe harbour', 'A person who discovers a vulnerability, reports it privately to the Department of Digital Security, and does not exploit it beyond what is needed to show it, commits no offence.'],
      ['Recognition', 'Valid reports may be recognised in the Gazette with the reporter\'s consent.'],
      ['Limits', `Safe harbour does not cover accessing other citizens' data or moving their ${C.plural}.`],
    ]),
    act('Account Security Act', SEC, 'digital', 'Citizens\' own responsibilities for their accounts.', [
      ['Strong passwords', 'Passwords must be at least 10 characters and mix letters with numbers or symbols.'],
      ['Changing passwords', 'Changing a password requires the .access key; the browser re-encrypts the key file with the new password, and all other sessions are signed out.'],
      ['Sessions', 'Sessions expire after 14 days. Signing out ends the session immediately.'],
    ]),

    // ---------------------------------------------------------------- Democracy & Elections
    act('National Assembly Procedure Act', DEM, 'assembly', 'How bills are tabled, signed, debated and voted on.', [
      ['Tabling', 'A citizen who has passed a passport check may table a bill with a title, summary and full text. A citizen may have at most 3 bills gathering signatures at once.'],
      ['Sponsorship', `The sponsor signs automatically. When ${SECURITY.billSignatureThreshold} citizens have signed, the bill opens for a ${SECURITY.billVotingDays}-day national vote.`],
      ['Debate', 'Debate takes place in the Policy & Legislation forum. Officials may not delete posts for their political content.'],
      ['Voting', 'Each citizen votes Yes, No or Abstain once, signed with their .access key. Votes cannot be changed.'],
      ['Result', 'When voting closes the result is published in the Gazette. A passed bill goes to the Head of State for assent.'],
      ['Withdrawal', 'A sponsor may withdraw a bill before voting opens.'],
    ]),
    act('Referendum and Constitutional Amendment Act', DEM, 'assembly', 'Special rules for changing the Constitution.', [
      ['Identification', 'A bill that amends the Constitution must say so in its title.'],
      ['Majority', 'It passes only with two thirds of votes cast in favour and turnout of at least one quarter of citizens.'],
      ['Assent', 'The Head of State may not veto a constitutional amendment that has passed; assent is a formality.'],
    ]),
    act('Elections Act', DEM, 'assembly', 'Framework for any future elected offices.', [
      ['Elected offices', 'An Act may make any office elected. Until then, officials are appointed by the Head of State.'],
      ['Conduct', 'Elections use the same signed-ballot system as national votes. Each citizen has one vote per office.'],
      ['Campaigning', 'Candidates may campaign in the Forum. Offering anything of value for votes is vote fraud.'],
    ]),
    act('Petitions Act', DEM, 'assembly', 'Citizens may petition the government on any matter.', [
      ['Petitions', 'Any citizen may open a petition thread in Policy & Legislation addressed to a department.'],
      ['Response', 'A department must respond publicly to any petition supported by one tenth of citizens.'],
    ]),
    act('Lobbying Transparency Act', DEM, 'assembly', 'Openness about influence on lawmaking.', [
      ['Disclosure', 'A citizen paid by anyone to promote or oppose a bill must disclose that in every post about the bill.'],
      ['Officials', 'Officials must record meetings about pending bills in the Gazette.'],
    ]),

    // ---------------------------------------------------------------- Constitution & Government
    act('Interpretation Act', GOV, 'judiciary', 'Rules for reading the laws of the nation.', [
      ['Plain meaning', 'Words in the laws have their ordinary meaning unless defined.'],
      ['Definitions', `"Citizen" means a person whose passport is current and who is not suspended. "Official" means a citizen appointed to a department. "${S}" means face value in ${C.plural}.`],
      ['Precedence', 'Constitution, then Acts, then Regulations, then Executive Orders. Later Acts prevail over earlier ones.'],
      ['Time', 'Times are measured in Coordinated Universal Time (UTC).'],
    ]),
    act('Government Departments Act', GOV, 'president', 'Establishes the departments of State and their duties.', [
      ['Departments', 'The departments are: Office of the Head of State; National Assembly; National Council; Supreme Tribunal; Citizenship & Identity; Treasury & Mint; Commerce; Justice; Digital Security; National Archives & Public Records; Applications Office; Communications; Education & Culture; Foreign Affairs.'],
      ['Mandates', 'Each department\'s mission and services are published on its page and bind its officials.'],
      ['Creation and abolition', 'A department may be created, merged or abolished only by Act.'],
    ]),
    act('Head of State Act', GOV, 'president', 'Powers, limits and succession of the Head of State.', [
      ['Powers', 'Assent and veto of bills; appointment and dismissal of officials; Executive Orders; suspension of citizens under law.'],
      ['Signatures', 'Appointments and suspensions must be signed with the Head of State\'s .access key and are published in the Gazette.'],
      ['Limits', 'The Head of State may not alter the ledger, view private keys, or override a ruling of the Supreme Tribunal.'],
      ['Succession', 'The Head of State may resign at any time once the National Council has at least one member. While the office is vacant, any citizen may apply through the Applications Office, and the National Council chooses by a majority of its members, not counting a member who is a candidate.'],
    ]),
    act('National Council Act', GOV, 'council', 'Composition, powers and procedure of the National Council.', [
      ['Composition', 'The National Council has seven seats: a Chair and six Council Members, appointed by the Head of State from citizens who apply through the Applications Office.'],
      ['Powers', '1. The Council advises the government and may question any official in the open forum.\n2. When the office of Head of State is vacant, the Council chooses the next Head of State.'],
      ['Choosing a Head of State', 'Each candidate is put to a vote of the Council. A candidate is chosen when more than half of the members, not counting a member who is the candidate, vote in favour. A candidate who can no longer reach that majority is not chosen. Votes are signed with each member\'s .access key and published.'],
      ['Leaving the Council', 'A member may resign at any time. The Head of State may dismiss a member, and the dismissal is published in the Gazette.'],
    ]),
    act('Public Offices and Appointments Act', ETH, 'appointments', 'How citizens apply for public office and who appoints them.', [
      ['Open offices', 'The Applications Office publishes every public office, its number of seats and its vacancies. Any citizen may apply for a vacant seat with a written statement.'],
      ['Appointing authority', '1. The Head of State: by the National Council.\n2. Heads of department and Council seats: by the Head of State.\n3. Deputies and officers: by the head of the department or the Head of State.'],
      ['Fair process', 'No one may decide their own application. A rejection must give reasons to the applicant. A citizen may hold one office at a time and have at most three applications open.'],
      ['Signatures and publication', 'Every appointment and Council vote is signed with the decider\'s .access key and published in the Gazette.'],
    ]),
    act('National Symbols Act', GOV, 'education', 'The seal, motto, colours and currency symbol of the nation.', [
      ['Seal', 'The national seal is a gold five-pointed star within a double gold ring on a navy field.'],
      ['Motto', `The national motto is *${N.motto}* ("truth in unity").`],
      ['Colours', 'The national colours are navy and gold.'],
      ['Protection', 'The seal may not be used in a way that suggests government endorsement without permission.'],
    ]),
    act('Official Gazette Act', GOV, 'records', 'The Gazette as the authoritative record of acts of State.', [
      ['Contents', 'The Gazette records the founding, conferral of citizenship, passport reissues, appointments, legislation, suspensions, rulings and official notices.'],
      ['Effect', 'An act of State required to be gazetted takes effect when it appears in the Gazette.'],
      ['Notices', 'Officials may publish notices in the Gazette.'],
    ]),
    act('Emergency Powers Act', GOV, 'president', 'Narrow, time-limited powers in a genuine emergency.', [
      ['Declaration', 'The Head of State may declare an emergency only for a security breach or attack that threatens national systems.'],
      ['Powers', 'During an emergency, the Department of Digital Security may pause sign-ins, transfers or listings.'],
      ['Limits', 'An emergency lasts at most 72 hours unless extended by national vote. It may never be used to alter the ledger, cancel votes or suspend the Forum for political reasons.'],
    ]),

    // ---------------------------------------------------------------- Public Service & Ethics
    act('Public Officials Ethics Act', ETH, 'justice', 'Standards of conduct for everyone who holds office.', [
      ['Duty', 'Officials act in the public interest, impartially, and within their mandate.'],
      ['Conflicts of interest', 'An official must not decide a matter in which they, a close friend or a business partner has an interest. They must step aside and record why.'],
      ['Gifts', `Officials may not accept gifts of more than 10 ${S} connected with their office.`],
      ['Misuse of data', 'An official who views identity documents for any purpose other than reviewing an application commits misconduct.'],
      ['Dismissal', 'Breach of this Act is grounds for dismissal by the Head of State.'],
    ]),
    act('Volunteer Public Service Act', ETH, 'president', 'Officials are citizens who volunteer their time.', [
      ['Volunteers', `Officials serve voluntarily and are not paid in ${C.plural} unless an Act provides otherwise.`],
      ['Recognition', 'Service is recognised in the Gazette and on the citizen\'s public profile.'],
      ['Leaving office', 'An official may resign at any time by notice to the Head of State.'],
    ]),
    act('Audit and Accountability Act', ETH, 'records', 'Every official action leaves a trace.', [
      ['Audit log', 'Sign-ins, application decisions, identity document views, moderation, appointments, suspensions and dispute rulings are recorded in the audit log.'],
      ['Review', 'The Head of State reviews the audit log; the Supreme Tribunal may order its disclosure in a case.'],
    ]),

    // ---------------------------------------------------------------- Culture, Education & Community
    act('National Holidays Act', CUL, 'education', 'Days of national celebration.', [
      ['Founding Day', `${new Date(N.founded).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}, the anniversary of the founding.`],
      ['Constitution Day', 'The first Saturday of March, celebrating self-government.'],
      ['Mint Day', `The first day of each quarter, celebrating the ${C.name}; the Treasury publishes its quarterly report.`],
      ['Observance', 'Holidays are celebrated with Forum events; no citizen is obliged to take part.'],
    ]),
    act('Culture and Arts Act', CUL, 'education', 'Support for the nation\'s creative life.', [
      ['Recognition', 'The Department of Education & Culture may recognise outstanding works and contributions in the Gazette.'],
      ['Events', 'The Department organises community events, contests and exhibitions in the Forum and Marketplace.'],
    ]),
    act('Official Language Act', CUL, 'education', 'Languages of government.', [
      ['Language', 'The working language of government is English.'],
      ['Other languages', 'Citizens may use any language in the Forum and Marketplace. Officials shall help citizens who need translation where they can.'],
    ]),
    act('Civic Education Act', CUL, 'education', 'Helping every citizen understand their nation.', [
      ['Guide', 'The State publishes a plain-language guide to citizenship, security and the law.'],
      ['Security literacy', 'The Department of Digital Security explains how the .access key and rotating server key protect citizens.'],
    ]),
    act('Community Grants Act', CUL, 'treasury', 'Funding for community projects, if one is ever created.', [
      ['No grants without an Act', `No ${C.plural} may be granted to projects except under an Act specifying the amount and the source.`],
      ['Source', 'Grants may be funded only by citizens\' voluntary contributions to a published account.'],
    ]),

    // ---------------------------------------------------------------- Foreign Affairs
    act('Foreign Relations Act', FOR, 'foreign', 'How the nation deals with other communities and with countries on Earth.', [
      ['Relations', 'The Department of Foreign Affairs may establish friendly relations with other online nations and communities.'],
      ['Law of countries', 'The nation respects the laws of countries on Earth. Nothing in its laws authorises conduct that is illegal where a citizen lives.'],
      ['Lawful requests', 'The nation responds to lawful requests from authorities, and discloses private data only when legally compelled; such disclosures are reported in the Gazette unless prohibited.'],
    ]),
    act('Treaties Act', FOR, 'foreign', 'Agreements with other communities.', [
      ['Negotiation', 'Foreign Affairs negotiates treaties.'],
      ['Ratification', 'A treaty binds the nation only when ratified by an Act passed by national vote.'],
    ]),
    act('Dual Nationality Act', FOR, 'foreign', `${N.short} citizenship sits alongside real-world nationality.`, [
      ['No conflict', `Citizenship of ${N.short} is not nationality in international law and does not replace or affect any real-world nationality.`],
      ['Travel', 'The national passport is a digital identity document for use within the nation only. It is not a travel document.'],
    ]),

    // ---------------------------------------------------------------- Regulations
    reg('Identity Review Standards Regulations', CIT, 'citizenship', 'What registrars must check before approving a citizen.', [
      ['Document', 'The document photograph must be legible, show a face, a name and a number, and appear unaltered.'],
      ['Selfie', 'The selfie must show the same person as the document photograph, performing the liveness prompt shown to the applicant.'],
      ['Flags', 'Every duplicate-person flag must be investigated before approval. A shared network alone is not a reason to refuse.'],
      ['Notes', 'A rejection or ban must include a note explaining the reason to the applicant.'],
    ]),
    reg('Liveness Prompt Regulations', CIT, 'citizenship', 'How liveness prompts are generated.', [
      ['Content', 'A prompt asks the applicant to hold up a number of fingers and show a note with two random words and a number.'],
      ['Expiry', 'A prompt expires after 30 minutes and after one submission.'],
    ]),
    reg('Passport Image Check Regulations', CIT, 'digital', 'Technical rules for the elevated security check.', [
      ['Accepted files', 'SVG or PNG files up to 6 MB downloaded from the holder\'s Passport page.'],
      ['Checks', 'The embedded token must carry a valid government signature, belong to the signed-in citizen, and match their current passport version.'],
      ['Duration', `A successful check unlocks elevated actions for ${PE} minutes on that session only.`],
    ]),
    reg('Key Reissue Regulations', CIT, 'citizenship', 'Procedure for replacing a lost .access key.', [
      ['Request', 'The citizen confirms the request with their password.'],
      ['Approval', 'A registrar approves only after satisfying themselves that the request is genuine, contacting the citizen where possible.'],
      ['Effect', 'On reissue, the key version and passport version increase; earlier passports and keys stop working; ledger signatures made with the old key remain valid records.'],
    ]),
    reg('Marketplace Listing Regulations', COM, 'commerce', 'Format and content of listings.', [
      ['Photos', 'Up to 4 photographs per listing, each up to 5 MB, in JPEG, PNG, WebP or GIF.'],
      ['Categories', 'Listings must be placed in the most accurate category: art, collectibles, digital, electronics, fashion, home, books, services, crafts or other.'],
      ['Condition and delivery', 'Every listing states its condition and delivery method (digital, shipping, pickup or service).'],
    ]),
    reg('Forum Moderation Procedure Regulations', RTS, 'justice', 'How officials handle reports.', [
      ['Timeliness', 'Reports should be reviewed within 72 hours.'],
      ['Options', 'An official may dismiss a report, remove content, or lock, pin or remove a thread.'],
      ['Record', 'Every moderation action is logged.'],
    ]),
    reg('Ledger Verification Regulations', TRE, 'treasury', 'How the public verification of the ledger works.', [
      ['Checks', 'Verification recomputes every entry hash, checks every link and Treasury signature, and checks every citizen signature against the parameters it covers.'],
      ['Reissued keys', 'A signature made with a since-replaced key is reported but does not make the chain invalid.'],
    ]),

    // ---------------------------------------------------------------- Executive Orders
    order('Founding Government Order', GOV, 'president', 'Establishes the founding government until officials are appointed.', [
      ['Founding Head of State', 'The founding Head of State exercises the functions of every department until officials are appointed.'],
      ['Appointments', 'The Head of State shall appoint a Registrar General for the Department of Citizenship & Identity as soon as practicable.'],
    ]),
    order('Application Review Timelines Order', CIT, 'citizenship', 'Service standard for citizenship applications.', [
      ['Target', 'The Department aims to decide every application within 7 days.'],
      ['Backlog', 'Where the backlog exceeds 7 days, the Department publishes a notice in the Gazette.'],
    ]),
    order('Dispute Resolution Standards Order', COM, 'commerce', 'Service standard for marketplace disputes.', [
      ['Target', 'Commerce officials aim to rule on disputes within 7 days.'],
      ['Reasons', 'Every ruling includes reasons both parties can read.'],
    ]),
  ];
}

