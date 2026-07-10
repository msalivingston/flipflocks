import { Libre_Caslon_Text, Source_Sans_3 } from "next/font/google";

export const storefrontSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const storefrontSerif = Libre_Caslon_Text({
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "700"],
});

export const storefrontSerifClass = `${storefrontSerif.className} storefront-serif`;
