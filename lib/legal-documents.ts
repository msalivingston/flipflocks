export type LegalDocumentBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "address"; lines: string[] };

export type LegalDocumentSection = {
  heading: string;
  blocks: LegalDocumentBlock[];
};

export type LegalDocument = {
  title: string;
  meta: string[];
  introduction: string[];
  sections: LegalDocumentSection[];
};

export const termsDocument: LegalDocument = {
  title: "FLOCKFRONT TERMS OF SERVICE",
  meta: ["Effective Date: August 8, 2026", "Version: 2026-08-08"],
  introduction: [
    "These Terms of Service are an agreement between you and Sunshine Mesa Farm LLC, operating as FlockFront (“FlockFront,” “we,” “us,” or “our”). They apply when you use FlockFront’s website, seller tools, storefronts, ordering tools, and related services.",
    "By accepting these Terms, creating an account, or using FlockFront, you agree to them. Our Privacy Policy and Acceptable Use and Prohibited Listings Policy are also part of these Terms.",
  ],
  sections: [
    {
      heading: "1. Accounts",
      blocks: [
        { type: "paragraph", text: "You must be at least 13 years old to use FlockFront. If you are under 18, you may use FlockFront only with the permission and supervision of a parent or legal guardian. Some payment features may require an adult." },
        { type: "paragraph", text: "Keep your account information accurate and protect your login credentials. You are responsible for activity through your account." },
      ],
    },
    {
      heading: "2. What FlockFront Does",
      blocks: [
        { type: "paragraph", text: "FlockFront provides software that independent sellers can use to create storefronts, list animals and products, manage inventory and orders, maintain customer records, and arrange pickup or delivery." },
        { type: "paragraph", text: "FlockFront is not the seller in transactions between buyers and sellers. We do not own, raise, inspect, test, handle, transport, or guarantee animals or products listed by sellers." },
        { type: "paragraph", text: "FlockFront does not provide veterinary, legal, tax, food-safety, or regulatory advice." },
      ],
    },
    {
      heading: "3. Seller Responsibilities",
      blocks: [
        { type: "paragraph", text: "Sellers are responsible for their own businesses, listings, and transactions." },
        { type: "list", items: [
          "Provide accurate information about animals, products, prices, availability, policies, and fulfillment.",
          "Have the legal right to sell or publish what they list.",
          "Follow applicable laws, permits, testing requirements, animal-health rules, labeling requirements, taxes, and other regulations.",
          "Fulfill accepted orders and communicate reasonably with buyers.",
          "Set and honor their own lawful pickup, delivery, cancellation, refund, replacement, and no-show policies.",
          "Use buyer information lawfully and protect customer information appropriately.",
        ] },
        { type: "paragraph", text: "The fact that FlockFront provides a listing category or feature does not mean a particular sale is legal in every location." },
      ],
    },
    {
      heading: "4. Pay at Pickup",
      blocks: [
        { type: "paragraph", text: "Pay at Pickup is available as a FlockFront payment option." },
        { type: "paragraph", text: "For an order designated Pay at Pickup, sellers may not require the buyer to send a deposit or advance payment through Venmo, Cash App, Zelle, PayPal, cryptocurrency, bank transfer, gift cards, or another outside payment method before pickup." },
        { type: "paragraph", text: "Sellers may accept cash, Venmo, or another lawful payment method when the buyer arrives." },
        { type: "paragraph", text: "Sellers accepting pickup orders must maintain a legitimate pickup address or meeting location. FlockFront may keep the exact pickup address private until after an order is placed." },
      ],
    },
    {
      heading: "5. Buyers and Orders",
      blocks: [
        { type: "paragraph", text: "Buyers purchase directly from the seller shown on the storefront." },
        { type: "paragraph", text: "FlockFront order confirmations record information submitted through the Service. They are not a guarantee by FlockFront that an animal or product is available, lawful, healthy, accurately described, or suitable for a particular purpose." },
        { type: "paragraph", text: "Buyers and sellers are responsible for resolving ordinary issues involving fulfillment, cancellations, refunds, pickup, delivery, and product condition." },
      ],
    },
    {
      heading: "6. Payments and Subscriptions",
      blocks: [
        { type: "paragraph", text: "FlockFront may offer paid subscription plans, trials, and optional payment-processing features. Current prices, plan limits, trial terms, and billing intervals will be shown before purchase." },
        { type: "paragraph", text: "Paid subscriptions automatically renew until canceled. Sellers may cancel through their account settings. Cancellation stops future renewal, while paid access may continue through the end of the current billing period." },
        { type: "paragraph", text: "Subscription fees are generally nonrefundable except where required by law or where FlockFront chooses to issue a refund or credit." },
        { type: "paragraph", text: "If online seller payments are available, they are processed through Stripe. Stripe may charge processing fees. FlockFront does not charge sellers a commission or percentage of their customer transactions." },
      ],
    },
    {
      heading: "7. Plan Limits and Changes",
      blocks: [
        { type: "paragraph", text: "Different FlockFront plans may have different features and limits." },
        { type: "paragraph", text: "If a seller moves to a plan with lower limits, features or listings above those limits may become unavailable. FlockFront will not automatically delete seller data solely because of a plan downgrade." },
        { type: "paragraph", text: "We may change features or pricing. We will provide notice of material changes when required by law." },
      ],
    },
    {
      heading: "8. Seller Content",
      blocks: [
        { type: "paragraph", text: "Sellers keep ownership of the photos, descriptions, logos, business information, and other content they provide." },
        { type: "paragraph", text: "Sellers give FlockFront permission to host, store, resize, format, and display that content as reasonably necessary to operate their storefront and provide the Service." },
        { type: "paragraph", text: "Sellers are responsible for ensuring they have the right to use the content they upload." },
      ],
    },
    {
      heading: "9. Buyer Information",
      blocks: [
        { type: "paragraph", text: "FlockFront may provide sellers with buyer information needed to manage orders and customer relationships." },
        { type: "paragraph", text: "Once a seller receives that information, the seller is responsible for using, storing, and protecting it lawfully. Sellers may not use buyer information for unlawful spam, harassment, fraud, or other unlawful purposes." },
      ],
    },
    {
      heading: "10. Acceptable Use",
      blocks: [
        { type: "paragraph", text: "You must follow the FlockFront Acceptable Use and Prohibited Listings Policy." },
        { type: "paragraph", text: "FlockFront may remove content, restrict features, unpublish a storefront, or suspend or terminate an account when reasonably necessary to address fraud, illegal activity, animal-welfare concerns, security issues, prohibited content, nonpayment, or material harm." },
      ],
    },
    {
      heading: "11. Ending an Account",
      blocks: [
        { type: "paragraph", text: "You may stop using FlockFront and cancel a paid subscription at any time through the available account tools." },
        { type: "paragraph", text: "When an account or subscription ends, storefront access or paid features may become unavailable. FlockFront may eventually delete account content when it is no longer reasonably necessary to provide the Service, subject to our Privacy Policy and applicable law." },
        { type: "paragraph", text: "We may retain records when reasonably necessary for payments, taxes, fraud prevention, security, disputes, legal compliance, or protection of legal rights." },
      ],
    },
    {
      heading: "12. Disclaimers and Liability",
      blocks: [
        { type: "paragraph", text: "FlockFront is provided “as is” and “as available.” We do not guarantee uninterrupted or error-free service or guarantee the identity, conduct, listings, animals, products, or performance of buyers or sellers." },
        { type: "paragraph", text: "To the fullest extent permitted by law, FlockFront is not liable for indirect, incidental, special, or consequential losses arising from use of the Service or from transactions between buyers and sellers." },
        { type: "paragraph", text: "To the fullest extent permitted by law, FlockFront’s total liability for claims relating to the Service will not exceed the greater of $100 or the amount you paid directly to FlockFront during the 12 months before the claim arose." },
        { type: "paragraph", text: "Some laws do not allow certain exclusions or limitations, so these provisions apply only to the extent permitted by law." },
      ],
    },
    {
      heading: "13. Your Responsibility for Claims",
      blocks: [
        { type: "paragraph", text: "To the extent permitted by law, you agree to protect and reimburse FlockFront for claims, losses, liabilities, and reasonable costs arising from your listings, content, animals, products, business practices, transactions, misuse of buyer information, violation of law, or violation of these Terms." },
      ],
    },
    {
      heading: "14. Disputes and Colorado Law",
      blocks: [
        { type: "paragraph", text: "Before filing a lawsuit, you and FlockFront agree to make a reasonable good-faith effort to resolve the dispute directly." },
        { type: "paragraph", text: "Colorado law governs these Terms. Court proceedings relating to these Terms must be brought in Colorado, subject to any rights or requirements that applicable law does not allow these Terms to change." },
      ],
    },
    {
      heading: "15. Changes to These Terms",
      blocks: [
        { type: "paragraph", text: "We may update these Terms as FlockFront changes. The current version will show its effective date." },
        { type: "paragraph", text: "For material changes, we may provide notice by email, through FlockFront, or another reasonable method. Where the law requires new consent, we will request it." },
        { type: "paragraph", text: "If part of these Terms is unenforceable, the rest remains in effect." },
      ],
    },
    {
      heading: "16. Contact",
      blocks: [
        { type: "address", lines: [
          "Sunshine Mesa Farm LLC, operating as FlockFront",
          "12347 3600 Rd.",
          "Hotchkiss, Colorado 81419",
          "hello@flockfront.com",
        ] },
      ],
    },
  ],
};

export const privacyDocument: LegalDocument = {
  title: "FLOCKFRONT PRIVACY POLICY",
  meta: ["Effective Date: ____________________"],
  introduction: [
    "Sunshine Mesa Farm LLC, doing business as FlockFront (\"FlockFront,\" \"we,\" \"us,\" or \"our\"), values privacy. This Policy explains how we collect, use, share, retain, and protect personal information when people use flockfront.com, seller dashboards, public storefronts, order tools, payment integrations, emails, and related services.",
  ],
  sections: [
    {
      heading: "1. Information We Collect",
      blocks: [
        { type: "paragraph", text: "The information we collect depends on how a person uses FlockFront." },
        { type: "list", items: [
          "Account and subscription information. Name, business or store name, email address, phone number, account credentials, plan, billing status, and subscription history.",
          "Storefront and seller information. Seller profile, location, policies, pickup or delivery information, listings, photos, descriptions, prices, availability, customer notes, and other content submitted by a seller.",
          "Buyer and order information. Name, email address, phone number, address when needed for fulfillment, order details, pickup or delivery selection, messages, and payment status.",
          "Payment information. Stripe or another payment provider processes payment credentials. FlockFront may receive limited transaction information such as payment status, amount, date, seller account identifier, refund status, and the last four digits or type of a payment method. FlockFront does not store full payment-card numbers.",
          "Technical and usage information. Internet Protocol address, browser and device information, login activity, pages and features used, approximate location derived from an IP address, cookies, error logs, security events, and similar operational information.",
          "Communications. Messages sent to FlockFront, support requests, survey responses, feedback, and records of notices and preferences.",
          "Information from sellers and service providers. A seller may enter customer information into FlockFront, and service providers may return information needed for authentication, payment status, email delivery, fraud prevention, or account administration.",
        ] },
      ],
    },
    {
      heading: "2. How We Use Information",
      blocks: [
        { type: "paragraph", text: "We use personal information to:" },
        { type: "list", items: [
          "Create and manage accounts, trials, subscriptions, storefronts, listings, orders, customers, and reports.",
          "Provide buyers' order information to the seller involved in the transaction.",
          "Process FlockFront subscription billing and support seller-connected payment features.",
          "Send order confirmations, pickup or delivery information, password resets, billing notices, security alerts, support messages, policy updates, and other service communications.",
          "Operate, maintain, troubleshoot, secure, measure, and improve FlockFront.",
          "Prevent fraud, abuse, unauthorized access, illegal activity, and violations of our policies.",
          "Comply with law, enforce agreements, respond to legal requests, and protect rights, safety, and property.",
          "Send account holders information about FlockFront features, updates, services, and offers. Marketing messages include an unsubscribe method.",
          "Create aggregated or de-identified information that does not reasonably identify an individual and use it to understand and improve the Service.",
        ] },
        { type: "paragraph", text: "We do not use buyer order information to send unrelated FlockFront marketing unless the buyer separately chooses to receive it. Service and transaction messages are not marketing and may still be sent when necessary to operate an account or order." },
      ],
    },
    {
      heading: "3. Our Privacy Promise",
      blocks: [
        { type: "paragraph", text: "FlockFront does not sell personal information. We do not allow third parties to use personal information for their own advertising or marketing, and we do not use personal information for advertising or marketing outside of FlockFront." },
        { type: "paragraph", text: "FlockFront may use contact information for FlockFront's own communications and marketing as described above. We do not use third-party advertising networks or sell lists of sellers, buyers, or customers." },
      ],
    },
    {
      heading: "4. When We Share Information",
      blocks: [
        { type: "paragraph", text: "We share personal information only as reasonably necessary for the purposes below:" },
        { type: "list", items: [
          "With the seller involved in an order. Buyer contact, address when applicable, order, pickup or delivery, payment-status, and communication information are provided to that seller.",
          "With service providers. We use providers for hosting, databases, authentication, email delivery, security, analytics, customer support, and payment processing. They may process information only to provide those services or as otherwise legally permitted, not for their own advertising or marketing.",
          "With Stripe or another payment provider. Payment providers process FlockFront subscription payments and seller-connected buyer payments under their own terms and privacy policies.",
          "Publicly at a seller's direction. Information a seller publishes on a storefront is available to visitors and may be shared by them.",
          "For legal, safety, and security reasons. We may disclose information when reasonably necessary to comply with law or legal process; investigate fraud, abuse, security incidents, or prohibited activity; or protect people, animals, FlockFront, users, service providers, rights, or property.",
          "In a business transfer. Information may be transferred in connection with a merger, financing, sale, reorganization, or transfer of all or part of FlockFront, subject to protections consistent with this Policy.",
          "With consent or at a user's direction. We may share information when the person asks us to or clearly authorizes it.",
        ] },
      ],
    },
    {
      heading: "5. Sellers and Buyer Information",
      blocks: [
        { type: "paragraph", text: "A seller receives buyer information as an independent business. The seller, not FlockFront, decides how to use and retain that information after receiving it and is responsible for the seller's own privacy, security, marketing, recordkeeping, and legal obligations." },
        { type: "paragraph", text: "A buyer who wants to know how a seller uses information should contact that seller. FlockFront is not responsible for a seller's independent use of information, but we may investigate misuse of the Service or violations of our policies." },
      ],
    },
    {
      heading: "6. Cookies and Analytics",
      blocks: [
        { type: "paragraph", text: "FlockFront uses cookies and similar technologies that are necessary to sign users in, secure accounts, remember preferences, maintain carts or sessions, prevent fraud, and operate the Service. We may also use limited, non-advertising analytics and error-monitoring tools to understand site performance and improve features." },
        { type: "paragraph", text: "FlockFront does not use third-party advertising cookies or permit advertising networks to build profiles from FlockFront activity. Browser settings may block some cookies, but doing so may prevent parts of the Service from working correctly." },
      ],
    },
    {
      heading: "7. Marketing and Communication Choices",
      blocks: [
        { type: "paragraph", text: "Account holders may receive occasional FlockFront marketing messages by default. Each marketing email will include an unsubscribe method. An unsubscribe request does not stop necessary transactional or service messages, including order notices, billing notices, password resets, security alerts, and material account or policy communications." },
        { type: "paragraph", text: "Sellers are independently responsible for their communications with buyers and for complying with applicable email, text-message, telemarketing, consent, and opt-out laws." },
      ],
    },
    {
      heading: "8. Data Retention and Account Closure",
      blocks: [
        { type: "paragraph", text: "We retain personal information while an account is active and as reasonably necessary to provide the Service. After a paid subscription ends, FlockFront may keep the account available for reactivation for 60 days. After that period, we may delete or de-identify listings, photos, store settings, breed-library content, customer records, and other account content." },
        { type: "paragraph", text: "We may retain limited records longer when reasonably necessary for accounting, taxes, payment disputes, fraud prevention, security, legal compliance, enforcement, or protection of legal rights. Backup copies may remain until overwritten through normal backup cycles. We do not keep personal information longer than reasonably necessary for the purpose for which it is retained." },
      ],
    },
    {
      heading: "9. Security",
      blocks: [
        { type: "paragraph", text: "FlockFront uses reasonable administrative, technical, and organizational safeguards appropriate to the information and the Service. No website, database, email, or transmission method can be guaranteed completely secure. Users should protect their passwords and promptly report suspected unauthorized access to hello@flockfront.com." },
      ],
    },
    {
      heading: "10. Access, Correction, Deletion, and Export",
      blocks: [
        { type: "paragraph", text: "A person may request access to, correction of, deletion of, or a portable copy of personal information maintained by FlockFront by emailing hello@flockfront.com. We may need to verify the requester's identity and authority before completing a request." },
        { type: "paragraph", text: "Some information may be retained or withheld when reasonably necessary to complete a transaction, maintain security, prevent fraud, comply with law, preserve legal rights, or protect another person's privacy. When applicable law provides additional rights or deadlines, FlockFront will follow them." },
        { type: "paragraph", text: "If FlockFront denies a privacy request, the requester may appeal by replying to the decision or emailing hello@flockfront.com with the subject line \"Privacy Appeal.\" Buyer information held independently by a seller must generally be requested from that seller." },
      ],
    },
    {
      heading: "11. Children and Teen Users",
      blocks: [
        { type: "paragraph", text: "FlockFront is not directed to children under 13, and children under 13 may not create accounts or provide personal information through the Service. If we learn that we collected personal information from a child under 13 without legally sufficient parental authorization, we will delete it or take other action required by law." },
        { type: "paragraph", text: "Users ages 13 through 17 may use FlockFront only with the permission and supervision of a parent or legal guardian. Certain billing and payment features may require an adult account holder." },
      ],
    },
    {
      heading: "12. Changes to This Policy",
      blocks: [
        { type: "paragraph", text: "We may update this Policy as FlockFront changes or legal requirements develop. The updated Policy will show a new effective or last-updated date. We may provide additional notice of material changes by email or through the Service." },
      ],
    },
    {
      heading: "13. Contact",
      blocks: [
        { type: "address", lines: [
          "Sunshine Mesa Farm LLC dba FlockFront",
          "12347 3600 Rd.",
          "Hotchkiss, Colorado 81419",
          "Email: hello@flockfront.com",
        ] },
      ],
    },
  ],
};

export const acceptableUseDocument: LegalDocument = {
  title: "FLOCKFRONT ACCEPTABLE USE AND PROHIBITED LISTINGS POLICY",
  meta: ["Effective Date: ____________________"],
  introduction: [
    "This Policy applies to every FlockFront account, storefront, listing, photo, message, order, customer record, and other use of the Service. It is intended to protect buyers, sellers, animals, FlockFront, and the integrity of the platform without creating an exhaustive list of every possible violation.",
  ],
  sections: [
    {
      heading: "1. Use FlockFront Lawfully and Honestly",
      blocks: [
        { type: "paragraph", text: "Users must follow applicable law, provide accurate information, act honestly, respect other people's rights, and use reasonable care when offering animals or products, arranging fulfillment, communicating, and handling customer information." },
      ],
    },
    {
      heading: "2. Appropriate Listings",
      blocks: [
        { type: "paragraph", text: "FlockFront is designed for poultry, livestock, farm, and homestead commerce. Lawful, reasonably related animals, products, equipment, and supplies may be listed even when a particular species is not named in a FlockFront category. A goat, rabbit, livestock item, or similar farm-related listing is not prohibited merely because FlockFront primarily serves poultry sellers." },
        { type: "paragraph", text: "Sellers are responsible for deciding whether a listing and transaction are lawful in the seller's and buyer's locations and whether permits, testing, inspections, certificates, labels, records, or other requirements apply." },
      ],
    },
    {
      heading: "3. Prohibited Listings and Content",
      blocks: [
        { type: "paragraph", text: "You may not list, publish, request, promote, or distribute content or items that are:" },
        { type: "list", items: [
          "Illegal to advertise, possess, transfer, transport, sell, or purchase in the applicable location.",
          "Stolen, counterfeit, recalled, unlawfully labeled, materially unsafe, or offered without the right to sell them.",
          "Fraudulent, materially misleading, deceptive, or presented with false claims about identity, condition, health, breed, origin, testing, certification, availability, price, or legal status.",
          "Connected with animal fighting, intentional cruelty, abuse, neglect, or another unlawful or materially harmful purpose.",
          "Protected wildlife or regulated species offered without lawful authority.",
          "Sick, injured, dangerous, or unfit animals when the sale or representation would be unlawful or materially deceptive.",
          "Prescription veterinary drugs, controlled substances, unlawfully offered medications, hazardous materials, or other regulated items that may not lawfully be sold through the Service.",
          "Weapons, illegal drugs, sexually explicit material, nonconsensual intimate images, digitally forged intimate images, or other content unrelated to legitimate farm, livestock, poultry, or homestead commerce.",
          "Infringing, including photos, logos, descriptions, or other material used without authorization.",
          "Designed to evade lawful animal-health, transportation, food, tax, consumer-protection, or other requirements.",
        ] },
        { type: "paragraph", text: "FlockFront may remove a listing or content that we reasonably believe creates legal, safety, animal-welfare, fraud, reputational, or platform-integrity concerns, whether or not the exact item is named above." },
      ],
    },
    {
      heading: "4. Prohibited Conduct",
      blocks: [
        { type: "paragraph", text: "You may not:" },
        { type: "list", items: [
          "Defraud, threaten, harass, discriminate against, impersonate, or deliberately mislead another person.",
          "Use buyer information for unlawful spam, harassment, fraud, unauthorized automated marketing, or another unlawful purpose.",
          "Upload malware, harmful code, or content intended to damage, disable, overload, or interfere with the Service.",
          "Probe, scan, bypass, or defeat security, authentication, access controls, plan limits, payment requirements, or technical restrictions.",
          "Access another account without permission or attempt to obtain passwords, payment information, private records, or other restricted data.",
          "Scrape, harvest, copy, sell, or commercially exploit user data, listings, photos, or the Service without written permission.",
          "Use bots or automation in a way that burdens the Service, manipulates availability or orders, or creates misleading activity.",
          "Use FlockFront to send deceptive messages, manipulate transactions, create false reviews or demand, or conceal unlawful conduct.",
          "Interfere with an investigation, submit a knowingly false complaint, or retaliate against a person who reports a concern in good faith.",
        ] },
      ],
    },
    {
      heading: "5. Copyright and Rights Complaints",
      blocks: [
        { type: "paragraph", text: "Report allegedly stolen or infringing photos, descriptions, logos, or other content to hello@flockfront.com. Include enough information for FlockFront to identify the protected work, locate the disputed material, contact the reporting person, and understand the basis of the complaint." },
        { type: "paragraph", text: "FlockFront may remove or restrict disputed content while reviewing a complaint and may terminate accounts of repeat infringers or users who repeatedly submit unlawful content." },
      ],
    },
    {
      heading: "6. Reporting Safety, Fraud, and Prohibited Content",
      blocks: [
        { type: "paragraph", text: "Report suspected fraud, stolen goods, animal-welfare concerns, dangerous content, nonconsensual intimate images, or other prohibited activity to hello@flockfront.com. Include the storefront or listing link, a description of the concern, and any supporting information that can be safely provided." },
        { type: "paragraph", text: "FlockFront may preserve records, restrict content, suspend accounts, contact affected users or service providers, or report conduct to law enforcement or another authority when reasonably necessary or legally required." },
      ],
    },
    {
      heading: "7. Enforcement",
      blocks: [
        { type: "paragraph", text: "FlockFront may warn a user, request information, remove or limit content, restrict features, unpublish a storefront, cancel an order affected by a technical or legal concern, suspend an account, or terminate access. We may act immediately when delay could increase harm, fraud, legal exposure, security risk, or danger to people or animals." },
        { type: "paragraph", text: "FlockFront is not required to monitor every listing or user and does not assume responsibility for content merely because it appears on the Service. Enforcement decisions may consider context, severity, history, available evidence, and the need to protect the Service and its users." },
      ],
    },
    {
      heading: "8. Contact",
      blocks: [
        { type: "address", lines: [
          "Sunshine Mesa Farm LLC dba FlockFront",
          "12347 3600 Rd.",
          "Hotchkiss, Colorado 81419",
          "Email: hello@flockfront.com",
        ] },
      ],
    },
  ],
};

