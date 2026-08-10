import Link from "next/link";
import {
  DashboardPageContent,
  SellerPageHeader,
} from "../_components/seller-ui";

type HelpStep = {
  title: string;
  intro?: string;
  steps: string[];
  note?: string;
  action?: { href: string; label: string };
};

const gettingStarted: HelpStep[] = [
  {
    title: "Finish setting up your store",
    steps: [
      "Choose Store Admin from your seller dashboard.",
      "Fill in your store information, contact information, pickup details, and store policies.",
      "Add clear pickup instructions. You may keep your exact pickup address private until after a customer orders.",
      "Choose the kinds of products you plan to sell.",
      "Select Save when you are finished.",
    ],
    note: "Look everything over before moving on. Keep your store details, policies, prices, and availability correct.",
    action: { href: "/dashboard/store-admin", label: "Open Store Admin" },
  },
  {
    title: "Add your first item for sale",
    intro: "FlockFront calls the birds and products you sell inventory.",
    steps: [
      "Choose Add Inventory from your seller dashboard.",
      "Choose Live Birds, Hatching Eggs, Poultry Products, or Equipment & Supplies.",
      "Add the requested details, such as the breed or product name, dates, price, quantity, photos, description, and pickup information.",
      "Check your price and quantity carefully.",
      "Select Save Draft if you want to finish later, or Publish inventory when the item is ready for customers.",
    ],
    note: "A published item appears under Inventory. Customers can see it once your store is live and shown to customers.",
    action: { href: "/dashboard/inventory/add-v2", label: "Add Inventory" },
  },
  {
    title: "Preview your store",
    steps: [
      "Choose Store Admin.",
      "Select Preview Store. On a phone, the button may say Preview.",
      "Check your store name, location, photos, pickup information, and policies.",
      "Open each item and check its photos, price, quantity, and available date.",
      "Return to Store Admin to make changes, then select Save.",
    ],
    action: { href: "/dashboard/store-admin", label: "Preview from Store Admin" },
  },
  {
    title: "Make your store visible to customers",
    steps: [
      "Choose Store Admin, then open Store status.",
      "Finish every required item shown on the page. You may need to finish billing and accept the Seller Terms.",
      "Select Launch Store.",
      "After the store is launched, select Show Store.",
      "Select Save to make the change take effect.",
      "Look for the message, Storefront is live.",
    ],
    note: "If Launch Store is not available, look for an unfinished item under Store status. You also need at least one published item with quantity available.",
    action: { href: "/dashboard/store-admin", label: "Open Store Admin" },
  },
  {
    title: "Share your store or an item",
    intro: "Your FlockFront store is your own store, not part of a shared marketplace. Customers find it through the links you share.",
    steps: [
      "Choose Inventory and find the item you want to share.",
      "Select Share listing.",
      "Choose Share now, Copy link, Share on Facebook, or the email option.",
      "To share your whole store, open Store Admin and copy the Public store URL.",
      "Paste the link into your website, Facebook page, social media, email, or a text message.",
    ],
    action: { href: "/dashboard/inventory", label: "Open Inventory" },
  },
  {
    title: "Keep your inventory up to date",
    steps: [
      "Choose Inventory.",
      "Find and open the item.",
      "Change the price, quantity, available date, photos, or description.",
      "Select Save Changes.",
    ],
    note: "If an item is unavailable, remove it from sale or set its available quantity to zero. For age-based pricing, check the current price from time to time.",
    action: { href: "/dashboard/inventory", label: "Manage Inventory" },
  },
  {
    title: "Handle a new order",
    steps: [
      "Choose Orders and open the order.",
      "Review the customer, items, quantities, price, payment method, pickup choice, and notes.",
      "Contact the customer if you need to confirm pickup or make a change.",
      "If the customer paid you, select Mark paid.",
      "After the customer receives the order, select Mark order fulfilled.",
      "Choose Mark fulfilled and paid for an order paid at pickup, or Mark fulfilled only if payment is still due or was recorded another way.",
      "Select Archive order when you are finished and want to move it out of your active orders.",
    ],
    note: "Do not mark an order fulfilled until the customer has received the birds or products.",
    action: { href: "/dashboard/orders", label: "View Orders" },
  },
  {
    title: "Manage your Breed Library",
    intro: "Your Breed Library keeps the breeds you raise and sell in one place. This makes them easier to choose when you add live birds or hatching eggs.",
    steps: [
      "Choose Breeds, then select Add Breed.",
      "Search for and select a breed from the Breed Library.",
      "If you cannot find it, choose Create Custom Breed and enter the requested details.",
      "Add a clear photo and description. Helpful details include egg color, adult size, temperament, laying habits, and how the breed handles your weather.",
      "To update a breed, open it from Breeds, make your changes, and select Save Changes.",
    ],
    action: { href: "/dashboard/breeds", label: "Manage Breeds" },
  },
];

const commonQuestions = [
  {
    question: "Why can't customers see my store?",
    answer:
      "Open Store Admin and check Store status. Finish every required item, then select Launch Store. Launching makes the storefront live and visible. Also make sure at least one inventory item is published and has quantity available.",
  },
  {
    question: "How does age-based pricing work?",
    answer:
      "Enter the hatch date and each price when adding or editing live birds. FlockFront uses the birds' age to show today's price. Check the item from time to time and select Save Changes after correcting anything.",
  },
  {
    question: 'What does "Pay at pickup" mean?',
    answer:
      "The customer places the order through FlockFront and pays you when the order is picked up or delivered. After payment, open the order and select Mark paid. If you are finishing it at the same time, select Mark order fulfilled, then Mark fulfilled and paid.",
  },
  {
    question: "What does the customer receive after ordering?",
    answer:
      "FlockFront sends an order confirmation with the information entered with the order. You are still responsible for filling the order and contacting the customer if availability, price, or pickup details change.",
  },
  {
    question: "How do I hide my store for a while?",
    answer:
      "Open Store Admin and Store status. Select Hide Store, then Save. To return, select Show Store, then Save.",
  },
];

export default function SellerHelpPage() {
  return (
    <>
      <SellerPageHeader
        title="Help & Getting Started"
        description="Simple steps for setting up your store, adding inventory, working with orders, and managing breeds."
      />
      <DashboardPageContent className="pb-28 lg:pb-8">
        <div className="mx-auto grid max-w-4xl gap-8">
          <section aria-labelledby="getting-started-heading">
            <h2
              className="text-xl font-bold text-stone-950"
              id="getting-started-heading"
            >
              Getting Started
            </h2>
            <div className="mt-4 grid gap-4">
              {gettingStarted.map((item, index) => (
                <article
                  className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6"
                  key={item.title}
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-sm font-bold text-white">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-bold text-stone-950">
                        {item.title}
                      </h3>
                      {item.intro ? (
                        <p className="mt-2 text-sm leading-6 text-stone-700">
                          {item.intro}
                        </p>
                      ) : null}
                      <ol className="mt-3 grid list-decimal gap-2 pl-5 text-sm leading-6 text-stone-700 marker:font-bold marker:text-emerald-800">
                        {item.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                      {item.note ? (
                        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
                          <strong>Good to know:</strong> {item.note}
                        </p>
                      ) : null}
                      {item.action ? (
                        <Link
                          className="seller-primary-button mt-4"
                          href={item.action.href}
                        >
                          {item.action.label}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="questions-heading">
            <h2
              className="text-xl font-bold text-stone-950"
              id="questions-heading"
            >
              Common Questions
            </h2>
            <div className="mt-4 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
              {commonQuestions.map((item) => (
                <details
                  className="group border-b border-stone-200 last:border-b-0"
                  key={item.question}
                >
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-base font-bold text-stone-950 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-700">
                    {item.question}
                    <span
                      aria-hidden="true"
                      className="text-xl text-emerald-800 transition group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="px-5 pb-5 text-sm leading-6 text-stone-700">
                    {item.answer}
                  </p>
                </details>
              ))}
            </div>
          </section>

          <aside className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-5 text-sm leading-6 text-emerald-950">
            <h2 className="font-bold">Still need help?</h2>
            <p className="mt-1">
              Email us at{" "}
              <a className="font-bold underline" href="mailto:hello@flockfront.com">
                hello@flockfront.com
              </a>
              . Tell us what you were trying to do, what happened, and which
              page you were on. Please do not send passwords or payment-card
              information.
            </p>
          </aside>
        </div>
      </DashboardPageContent>
    </>
  );
}
