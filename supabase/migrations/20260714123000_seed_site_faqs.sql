-- Initial approved FlockFront FAQ content.
-- Uses fixed IDs so resets/replays do not duplicate the seed rows.

insert into public.site_faqs (
  id,
  question,
  answer,
  is_published,
  sort_order
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    $faq$What is FlockFront?$faq$,
    $faq$FlockFront gives you a simple place to show people what birds you have available, take orders, and keep everything organized. It's like having your own farm store online—without having to build one yourself.$faq$,
    true,
    0
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    $faq$Who is FlockFront for?$faq$,
    $faq$FlockFront is for people who regularly sell poultry and are tired of constantly updating Facebook posts, changing prices as birds grow, or getting posts removed for including prices. It gives buyers one place to see what's actually available, so you spend less time fixing listings and answering the same questions.$faq$,
    true,
    1
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    $faq$Do I need to accept online payments, and how do payments work?$faq$,
    $faq$Nope. If you like collecting payment when folks pick up their birds, that's perfectly fine. If you'd rather accept payments online, you can connect your own Stripe account, and we'll walk you through the setup. It's your business.$faq$,
    true,
    2
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    $faq$Do I need a website to use FlockFront?$faq$,
    $faq$Nope! FlockFront creates one for you. Add your birds, upload a few photos, and start sharing your link.$faq$,
    true,
    3
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    $faq$Can I hide my store until I'm ready?$faq$,
    $faq$Absolutely. Your store stays hidden until you're ready for people to see it. Get everything just the way you want first.$faq$,
    true,
    4
  ),
  (
    '10000000-0000-4000-8000-000000000006',
    $faq$Is there a limit to how many birds I can list?$faq$,
    $faq$The Coop plan includes up to five listings for sale at one time. You can still keep as many additional listings saved as you'd like. Market removes the limit completely.$faq$,
    true,
    5
  ),
  (
    '10000000-0000-4000-8000-000000000007',
    $faq$Can I use my own domain name?$faq$,
    $faq$Yep! If you already own a domain, you can point it to your FlockFront store.$faq$,
    true,
    6
  ),
  (
    '10000000-0000-4000-8000-000000000008',
    $faq$Can I sell more than just live poultry?$faq$,
    $faq$Yes! The Market plan also lets you list hatching eggs, poultry products, and equipment and supplies, so everything you sell can be in one place.$faq$,
    true,
    7
  ),
  (
    '10000000-0000-4000-8000-000000000009',
    $faq$Can I charge different prices as my birds grow?$faq$,
    $faq$Absolutely. With the Market plan, you can set your pricing once, and FlockFront automatically updates it as your birds get older. One less thing to keep track of.$faq$,
    true,
    8
  ),
  (
    '10000000-0000-4000-8000-000000000010',
    $faq$Does FlockFront support shipping?$faq$,
    $faq$Not yet. FlockFront is built around local pickup, since that's how most independent poultry sellers do business. Shipping support may be added in a future update.$faq$,
    true,
    9
  ),
  (
    '10000000-0000-4000-8000-000000000011',
    $faq$Does FlockFront take a commission on my sales?$faq$,
    $faq$Nope. We don't take a cut of what you sell. If you sell another dozen chicks this weekend, that money belongs to you.$faq$,
    true,
    10
  ),
  (
    '10000000-0000-4000-8000-000000000012',
    $faq$What if I only sell during part of the year?$faq$,
    $faq$That's pretty common. During slower months, you can switch to the $5 per month Coop plan. Your store, listings, and photos will be waiting when you're ready to start selling again.$faq$,
    true,
    11
  ),
  (
    '10000000-0000-4000-8000-000000000013',
    $faq$What happens if I cancel my subscription?$faq$,
    $faq$If you think you'll be back, we recommend switching to the $5 per month Coop plan instead. Your store stays intact, and you won't have to start all over next season.$faq$,
    true,
    12
  ),
  (
    '10000000-0000-4000-8000-000000000014',
    $faq$Can I change my plan later?$faq$,
    $faq$Of course. If your flock grows, your plan can too. And if things slow down, you can switch to a different plan anytime.$faq$,
    true,
    13
  ),
  (
    '10000000-0000-4000-8000-000000000015',
    $faq$Can I use FlockFront from my phone?$faq$,
    $faq$Yep! Whether you're in the chicken yard, the barn, or sitting at the kitchen table, you can manage your store from your phone, tablet, or computer.$faq$,
    true,
    14
  )
on conflict (id) do update
set
  question = excluded.question,
  answer = excluded.answer,
  is_published = excluded.is_published,
  sort_order = excluded.sort_order;
