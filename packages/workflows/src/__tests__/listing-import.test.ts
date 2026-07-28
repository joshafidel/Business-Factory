import { describe, expect, it } from "vitest";
import { extractListingData } from "../listing-factory/listing-import";

const PAGE_URL = "https://averyrealty.example.com/listings/12-maple-st";

const FULL_PAGE = `<!doctype html><html><head>
<meta property="og:title" content="12 Maple St, Pittsburgh, PA 15213 | Avery Realty" />
<meta property="og:description" content="Renovated 3-bed with a fenced backyard." />
<meta property="og:image" content="https://cdn.example.com/photos/hero.jpg" />
<meta property="og:image" content="/photos/kitchen.jpg" />
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "RealEstateListing",
      "name": "12 Maple St",
      "description": "Renovated kitchen with <b>quartz counters</b>. Fenced backyard.",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "12 Maple St",
        "addressLocality": "Pittsburgh",
        "addressRegion": "PA",
        "postalCode": "15213"
      },
      "numberOfBedrooms": 3,
      "numberOfBathroomsTotal": 2,
      "floorSize": { "@type": "QuantitativeValue", "value": 1850, "unitCode": "FTK" },
      "offers": { "@type": "Offer", "price": "459000", "priceCurrency": "USD" },
      "image": [
        "https://cdn.example.com/photos/hero.jpg",
        { "@type": "ImageObject", "url": "https://cdn.example.com/photos/living.jpg" },
        "http://insecure.example.com/photo.jpg",
        "https://192.168.1.5/internal.jpg"
      ],
      "agent": {
        "@type": "RealEstateAgent",
        "name": "Jordan Avery",
        "telephone": "(412) 555-0142",
        "email": "mailto:jordan@averyrealty.example.com",
        "worksFor": { "@type": "Organization", "name": "Avery Realty Group" }
      }
    }
  ]
}
</script></head><body></body></html>`;

describe("extractListingData", () => {
  it("pulls property facts, the realtor, and safe photo URLs from JSON-LD", () => {
    const result = extractListingData(FULL_PAGE, PAGE_URL);
    expect(result.property.address).toBe("12 Maple St, Pittsburgh, PA, 15213");
    expect(result.property.price).toBe("$459,000");
    expect(result.property.beds).toBe("3");
    expect(result.property.baths).toBe("2");
    expect(result.property.sqft).toBe("1850");
    expect(result.property.description).toContain("quartz counters");
    expect(result.property.description).not.toContain("<b>");
    expect(result.property.agentName).toBe("Jordan Avery");
    expect(result.property.brokerage).toBe("Avery Realty Group");
    expect(result.property.agentPhone).toBe("(412) 555-0142");
    expect(result.property.agentEmail).toBe("jordan@averyrealty.example.com");
    expect(result.property.listingUrl).toBe(PAGE_URL);
    // http + private-host images rejected; og:image deduped with JSON-LD;
    // relative og:image resolved against the page URL.
    expect(result.photoUrls).toEqual([
      "https://cdn.example.com/photos/hero.jpg",
      "https://cdn.example.com/photos/living.jpg",
      "https://averyrealty.example.com/photos/kitchen.jpg",
    ]);
  });

  it("falls back to Open Graph when there is no JSON-LD", () => {
    const html = `<html><head>
      <meta property="og:title" content="Charming bungalow at 7 Oak Ave" />
      <meta property="og:description" content="Two bedrooms, big porch." />
      <meta property="og:image" content="https://cdn.example.com/oak.jpg" />
    </head></html>`;
    const result = extractListingData(html, PAGE_URL);
    expect(result.property.address).toBe("Charming bungalow at 7 Oak Ave");
    expect(result.property.description).toBe("Two bedrooms, big porch.");
    expect(result.photoUrls).toEqual(["https://cdn.example.com/oak.jpg"]);
    expect(result.title).toBe("Charming bungalow at 7 Oak Ave");
  });

  it("returns empty results for a page with no structured data", () => {
    const result = extractListingData("<html><body>hello</body></html>", PAGE_URL);
    expect(result.property.address).toBeUndefined();
    expect(result.photoUrls).toEqual([]);
  });

  it("survives malformed JSON-LD blocks", () => {
    const html = `<script type="application/ld+json">{not json</script>
      <meta property="og:image" content="https://cdn.example.com/x.jpg" />`;
    expect(extractListingData(html, PAGE_URL).photoUrls).toEqual(["https://cdn.example.com/x.jpg"]);
  });
});
