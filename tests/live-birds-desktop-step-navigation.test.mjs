import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(
  new URL(
    "../app/dashboard/inventory/add-v2/live-birds/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const navSource = await readFile(
  new URL(
    "../app/dashboard/inventory/add-v2/live-birds/DesktopLiveBirdsStepNav.tsx",
    import.meta.url,
  ),
  "utf8",
);
const sectionCardSource = await readFile(
  new URL(
    "../app/dashboard/inventory/add-v2/live-birds/SectionCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
const hatchCardSource = await readFile(
  new URL(
    "../app/dashboard/inventory/add-v2/live-birds/HatchInformationCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
const birdOfferingsSource = await readFile(
  new URL(
    "../app/dashboard/inventory/add-v2/live-birds/BirdOfferingsCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
const reviewPublishSource = await readFile(
  new URL(
    "../app/dashboard/inventory/add-v2/live-birds/ReviewPublishCard.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("desktop Live Birds navigation uses the existing active and unlock state", () => {
  assert.match(
    pageSource,
    /activeStep=\{desktopExpandedStep \?\? 1\}/,
  );
  assert.match(
    pageSource,
    /highestUnlockedStep=\{highestUnlockedDesktopStep\}/,
  );
  assert.match(pageSource, /onStepSelect=\{setDesktopExpandedStep\}/);
  assert.match(navSource, /const disabled = step > highestUnlockedStep/);
  assert.match(navSource, /disabled=\{disabled\}/);
});

test("all four desktop steps remain mounted and use panel visibility", () => {
  for (const component of [
    "HatchInformationCard",
    "BirdOfferingsCard",
    "AgeBasedPriceChangesCard",
    "ReviewPublishCard",
  ]) {
    assert.match(pageSource, new RegExp(`<${component}`));
  }

  assert.match(sectionCardSource, /desktopPanelMode && !desktopExpanded/);
  assert.match(sectionCardSource, /"sm:hidden"/);
  assert.match(pageSource, /desktopPanelMode/);
  assert.match(pageSource, /desktopActive=\{desktopExpandedStep === 4\}/);
});

test("Edit Live Birds reuses the Add tabs with management wording", () => {
  assert.match(pageSource, /mode=\{mode\}/);
  assert.match(navSource, /label: "Review & Save"/);
  assert.match(navSource, /Edit Live Birds sections/);
  assert.match(pageSource, />\(isEditMode \? 2 : 1\);/);
  assert.doesNotMatch(pageSource, /<EditCurrentStateSummary/);
  assert.match(pageSource, /<EditPricingContext/);
  assert.doesNotMatch(navSource, /saveAction/);
  assert.match(pageSource, /<EditStickySaveBar/);
});

test("desktop publish validation activates a target panel before focus", () => {
  assert.match(
    pageSource,
    /setDesktopExpandedStep\(1\);[\s\S]*?setTimeout\(focusHatchField, 0\)/,
  );
  assert.match(
    pageSource,
    /setDesktopExpandedStep\(2\);[\s\S]*?setTimeout\(\(\) => setScrollToOfferingId\(offeringId\), 0\)/,
  );
});

test("desktop shell remains scoped to the existing sm breakpoint", () => {
  assert.match(navSource, /className="hidden sm:block"/);
  assert.match(pageSource, /sm:grid-cols-\[11\.25rem_minmax\(0,1fr\)\]/);
  assert.match(pageSource, /lg:grid-cols-\[12\.25rem_minmax\(0,1fr\)\]/);
  assert.match(pageSource, /window\.matchMedia\("\(min-width: 640px\)"\)/);
});

test("desktop tabs connect to aligned active panels without the help footer", () => {
  assert.match(navSource, /rounded-l-lg/);
  assert.doesNotMatch(navSource, /Need help\?/);
  assert.doesNotMatch(navSource, /lockedDescription/);
  assert.doesNotMatch(navSource, /Step \$\{step\} of 4/);
  assert.match(pageSource, /sm:gap-0/);
  assert.match(pageSource, /sm:-ml-px sm:space-y-0/);
  assert.match(sectionCardSource, /desktopPanelMode \? "sm:rounded-l-none"/);
});

test("desktop artwork and breed content use the compact panel layout", () => {
  assert.match(hatchCardSource, /desktopHeaderArtwork=/);
  assert.equal(
    (hatchCardSource.match(/sm:text-sm sm:font-semibold sm:text-stone-600/g) ?? [])
      .length,
    2,
    "desktop Hatch Details labels should match Birds for Sale label sizing",
  );
  assert.match(
    hatchCardSource,
    /lg:grid-cols-\[0\.9fr_1fr_1\.25fr\]/,
  );
  assert.match(
    hatchCardSource,
    /desktopPanelMode \? "" : "relative pr-0 xl:pr-36"/,
  );
  assert.match(birdOfferingsSource, /desktopPanelMode \? "sm:grid-cols-1"/);
  assert.match(birdOfferingsSource, /desktopPanelMode \? "sm:col-span-1"/);
  assert.match(birdOfferingsSource, /compactDesktop \? "sm:w-2\/3"/);
  assert.match(
    birdOfferingsSource,
    /desktopPanelMode \? "sm:min-h-42" : "sm:min-h-56"/,
  );
  assert.match(
    birdOfferingsSource,
    /lg:grid-cols-\[minmax\(0,1\.4fr\)_minmax\(0,1fr\)_minmax\(8rem,0\.7fr\)_minmax\(8rem,0\.75fr\)\]/,
  );
  assert.match(birdOfferingsSource, /"Breed Photo and Description"/);
  assert.match(
    birdOfferingsSource,
    /desktopPanelMode \? "hidden sm:inline"/,
  );
  assert.match(reviewPublishSource, /name="nest"/);
  assert.equal(
    (pageSource.match(/Almost there!/g) ?? []).length,
    1,
    "only the existing mobile Almost there message should remain",
  );
});
